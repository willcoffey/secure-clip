/**
 * End-to-end: drive the seclip CLI as a subprocess and check that what goes
 * into `set` comes back out of `get` (HTTP) and `subscribe` (socket)
 * byte-for-byte, and that `get | set` round trips never mutate the clip.
 *
 * Needs the worker running (npm run worker) and:
 *   node --test test/pipe-mutation-e2e.ai.test.ts
 */
import { describe, test } from "node:test";
import { deepStrictEqual, notStrictEqual } from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { availableParallelism } from "node:os";

const CLI = fileURLToPath(new URL("../frontend/src/seclip.ts", import.meta.url));
const HOST = "localhost:3000";
const SALT = "znmnw6bsmppdwzymz2kehmcftm2mjh4k";
const enc = new TextEncoder();
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
const board = () => `e2e-${crypto.randomUUID()}`;
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
};

interface Result {
  code: number;
  stdout: Uint8Array;
  stderr: string;
}

/** Run the CLI. stdin is written as separate chunks with a gap between. */
async function cli(
  args: string[],
  chunks: Uint8Array[] = [],
  gapMs = 50,
  onStdout?: () => void,
): Promise<Result> {
  const child = spawn(process.execPath, [CLI, "-d", HOST, "--nossl", "--salt", SALT, ...args], {
    stdio: "pipe",
  });
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  child.stdout.on("data", (c: Buffer) => {
    out.push(c);
    onStdout?.();
  });
  child.stderr.on("data", (c: Buffer) => err.push(c));
  child.stdin.on("error", () => {}); // EPIPE if the CLI exits before reading all stdin
  const done = new Promise<number>((res, rej) => {
    child.on("error", rej);
    child.on("close", (code) => res(code ?? 1));
  });
  for (const [i, chunk] of chunks.entries()) {
    if (i > 0) await sleep(gapMs);
    await new Promise((res) => child.stdin.write(chunk, res));
  }
  child.stdin.end();
  const code = await done;
  // plain Uint8Array, not Buffer, so deepStrictEqual matches the expected bytes
  return { code, stdout: new Uint8Array(Buffer.concat(out)), stderr: Buffer.concat(err).toString() };
}

const set = (pass: string, chunks: Uint8Array[]) =>
  cli(["--passphrase", pass, "set"], chunks);
const getHttp = (pass: string) => cli(["--passphrase", pass, "get"]);
const getSocket = (pass: string) =>
  cli(["--passphrase", pass, "-n", "1", "subscribe"]);

/** set the bytes, then check both read paths return exactly them. */
async function assertRoundTrip(chunks: Uint8Array[]) {
  const pass = board();
  const expected = cat(...chunks);
  const s = await set(pass, chunks);
  deepStrictEqual(s.code, 0, s.stderr);
  deepStrictEqual(s.stdout, new Uint8Array(), "set should print nothing");
  const http = await getHttp(pass);
  deepStrictEqual(http.code, 0, http.stderr);
  deepStrictEqual(http.stdout, expected, "get (http) mutated the clip");
  const sock = await getSocket(pass);
  deepStrictEqual(sock.code, 0, sock.stderr);
  deepStrictEqual(sock.stdout, expected, "subscribe (socket) mutated the clip");
}

/** Split bytes into chunks at the given offsets. */
const split = (bytes: Uint8Array, ...at: number[]) =>
  [0, ...at].map((start, i) => bytes.slice(start, at[i] ?? bytes.length));

const texts: Record<string, string> = {
  "no trailing newline": "foo",
  "trailing newline": "foo\n",
  "several trailing newlines": "foo\n\n\n",
  "only newlines": "\n\n",
  "CRLF": "line1\r\nline2\r\n",
  "trailing whitespace": "foo \t ",
  "leading whitespace": "  \tfoo",
  "empty": "",
  "unicode": "héllo wörld — 日本語 🎉👨‍👩‍👧 é",
  "leading BOM": "﻿bom first",
  "NUL and control chars": "a\0b\x01\x1b[31mred\x1b[0m\x7f",
};

// Each test uses its own random board, so they can run concurrently.
describe("seclip e2e", { concurrency: availableParallelism() }, () => {
  for (const [name, text] of Object.entries(texts)) {
    test(`round trip: ${name}`, () => assertRoundTrip([enc.encode(text)]));
  }

  test("round trip: 4-byte emoji split across stdin chunks", () => {
    const bytes = enc.encode("a🎉b");
    return assertRoundTrip(split(bytes, 2)); // cuts inside the emoji
  });

  test("round trip: every multibyte boundary split", async () => {
    const bytes = enc.encode("é日🎉");
    for (let cut = 1; cut < bytes.length; cut++) {
      await assertRoundTrip(split(bytes, cut));
    }
  });

  test("round trip: one byte per chunk", () => {
    const bytes = enc.encode("ü🎉\n");
    return assertRoundTrip([...bytes].map((b) => Uint8Array.of(b)));
  });

  test("round trip: large multibyte text over 64KB pipe chunk", () => {
    // ~80KB: past the usual 64KB pipe chunk, under the worker's size limit
    const bytes = enc.encode("日本語🎉\n".repeat(80_000 / 14));
    return assertRoundTrip([bytes]);
  });

  test("get | set is idempotent", async () => {
    for (const text of ["foo", "foo\n", "🎉 x \r\n"]) {
      const pass = board();
      const expected = enc.encode(text);
      await set(pass, [expected]);
      for (let i = 0; i < 3; i++) {
        const got = await getHttp(pass);
        await set(pass, [got.stdout]);
      }
      const final = (await getHttp(pass)).stdout;
      deepStrictEqual(final, expected, `drifted: ${JSON.stringify(text)}`);
    }
  });

  test("get | set onto a different board copies exactly", async () => {
    const [a, b] = [board(), board()];
    const expected = enc.encode("copy me 🎉\n\n");
    await set(a, [expected]);
    await set(b, [(await getHttp(a)).stdout]);
    deepStrictEqual((await getHttp(b)).stdout, expected);
    deepStrictEqual((await getSocket(b)).stdout, expected);
  });

  test("subscribe receives live updates unmodified", async () => {
    const pass = board();
    const first = enc.encode("first");
    const second = enc.encode("second\n");
    await set(pass, [first]);
    // -n 2: the initial load, then the pushed update
    // wait for the initial load so we know the socket is up before updating
    let loaded!: () => void;
    const ready = new Promise<void>((res) => (loaded = res));
    const sub = cli(["--passphrase", pass, "-n", "2", "subscribe"], [], 50, () => loaded());
    await ready;
    await set(pass, [second]);
    const { code, stdout, stderr } = await sub;
    deepStrictEqual(code, 0, stderr);
    deepStrictEqual(stdout, cat(first, second));
  });

  test("oversize set fails loudly instead of silently dropping", async () => {
    const pass = board();
    await set(pass, [enc.encode("keep")]);
    const big = await set(pass, [enc.encode("x".repeat(200_000))]);
    notStrictEqual(big.code, 0, "oversize set exited 0");
    deepStrictEqual((await getHttp(pass)).stdout, enc.encode("keep"));
  });
});
