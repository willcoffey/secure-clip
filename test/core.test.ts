import { assertEquals, assertNotEquals } from "@std/assert";
import { Encrypted, SecureClip } from "../frontend/src/core.ts";

const options = { host: "localhost:3000", salt: "znmnw6bsmppdwzymz2kehmcftm2mjh4k", ssl: false };
const rand = () => crypto.randomUUID();
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
const settings = {
  passphrase: "swordfish",
  plaintext: "The password is always swordfish",
  encrypted: {
    "ciphertext": "YHpXn07ciRKnt0rHP4tqG+USDBf0klzby5mWm6va15CSRM39aY8r6oIVNgZX+11t",
    "iv": "NCvcp8m8OmgZwOvS",
  },
};

/**
 * Sets the passphrase to known value and stores the ciphertext on the server.
 * sleeps since it's fire-and-forget
 *
 * set-plaintext = encrypt plaintext, send update to server
 */
Deno.test("set-plaintext", async () => {
  const clip = new SecureClip(options, "swordfish");
  await clip.stdin({ command: "set-plaintext", body: settings.plaintext });
  await sleep(100);
  assertEquals(clip.state.plaintext, settings.plaintext);
});

/*
 * set-passphrase = derive key & id, send load request
 */
Deno.test("set-passphrase", async () => {
  const clip = new SecureClip(options, settings.passphrase);
  await clip.stdin({ command: "set-passphrase", body: settings.passphrase });
  await sleep(100);
  assertEquals(clip.state.plaintext, settings.plaintext);
});

/*
 * set-ciphertext = decrypt ciphertext, set plaintext for user to see
 */
Deno.test("set-ciphertext", async () => {
  const clip = new SecureClip(options, settings.passphrase);
  await clip.stdin({ command: "set-ciphertext", body: settings.encrypted });
  assertEquals(clip.state.plaintext, settings.plaintext);
});
