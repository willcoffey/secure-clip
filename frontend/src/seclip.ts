import { parseCommandLineOptions } from "utilities";
import { SecureClip } from "./core.ts";

async function main() {
  const opts = parseCommandLineOptions(Deno.args, { d: true, passphrase: true });

  if (opts.flags.h || opts.flags.help) {
    console.log(`Secure clipboard CLI.
Usage: seclip [OPTIONS] get|set

  -h, --help              Print help
  -d [HOST]               Host (default: 127.0.0.1:3000)
  --passphrase [PHRASE]   Passphrase (default: SECLIP_PASSPHRASE env var)

Examples:
  seclip get
  echo "hello" | seclip set
  seclip -d example.com --passphrase hunter2 get`);
    return;
  }

  const host = opts.options.d ?? "127.0.0.1:3000";
  const passphrase = opts.options.passphrase ?? Deno.env.get("SECLIP_PASSPHRASE");
  if (!passphrase) throw "ERR: No passphrase. Use --passphrase or set SECLIP_PASSPHRASE";

  const command = opts.operands[0];
  if (command !== "get" && command !== "set") {
    console.error("ERR: command must be get or set");
    Deno.exit(1);
  }

  const secure = !host.startsWith("127.") && !host.startsWith("localhost");
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
