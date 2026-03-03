import { parseCommandLineOptions } from "utilities";
import { SecureClip } from "./core.ts";

async function main() {
  const opts = parseCommandLineOptions(Deno.args, { d: true, passphrase: true, n: true });

  if (opts.flags.h || opts.flags.help) {
    console.log(`Secure clipboard CLI.
Usage: seclip [OPTIONS] get|set|subscribe

  -h, --help              Print help
  -d [HOST]               Host (default: 127.0.0.1:3000)
  --passphrase [PHRASE]   Passphrase (default: SECLIP_PASSPHRASE env var)
  -n [COUNT]              (subscribe) Exit after receiving COUNT messages

Examples:
  seclip get
  echo "hello" | seclip set
  seclip subscribe
  seclip -n 1 subscribe
  seclip -d example.com --passphrase hunter2 get`);
    return;
  }

  const host = opts.options.d ?? "127.0.0.1:3000";
  const passphrase = opts.options.passphrase ?? Deno.env.get("SECLIP_PASSPHRASE");
  if (!passphrase) throw "ERR: No passphrase. Use --passphrase or set SECLIP_PASSPHRASE";

  const command = opts.operands[0];
  if (command !== "get" && command !== "set" && command !== "subscribe") {
    console.error("ERR: command must be get, set, or subscribe");
    Deno.exit(1);
  }

  const secure = !host.startsWith("127.") && !host.startsWith("localhost");

  if (command === "subscribe") {
    const core = new SecureClip({ passphrase, host, secure, connection: "ws" });
    const limit = opts.options.n ? parseInt(opts.options.n) : Infinity;
    let count = 0;
    let initial = true;
    core.render = (plaintext) => {
      if (initial) { initial = false; return; }
      console.log(plaintext);
      if (++count >= limit) Deno.exit(0);
    };
    await new Promise(() => {});
    return;
  }

  const core = new SecureClip({ passphrase, host, secure, connection: "post" });

  if (command === "get") {
    core.render = (plaintext) => {
      console.log(plaintext);
      Deno.exit(0);
    };
  }

  if (command === "set") {
    const chunks: string[] = [];
    const decoder = new TextDecoder();
    for await (const chunk of Deno.stdin.readable) {
      chunks.push(decoder.decode(chunk));
    }
    const text = chunks.join("").trimEnd();
    await core.stdin({ action: "set-plaintext", args: text });
  }
}

main();
