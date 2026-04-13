import { parseCommandLineOptions } from "utilities";
import { SecureClip, sleep } from "./core.ts";

async function main() {
  const opts = parseCommandLineOptions(Deno.args, {
    d: true,
    passphrase: true,
    n: true,
  });

  if (opts.flags.h || opts.flags.help) {
    console.log(`Secure clipboard CLI.
Usage: seclip [OPTIONS] get|set|subscribe

  -h, --help              Print help
  -d [HOST]               Host (default: 127.0.0.1:3000)
  --passphrase [PHRASE]   Passphrase (default: SECLIP_PASSPHRASE env var)
  --nossl                 Use plain HTTP or WS for connection
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
  const ssl = opts.flags.nossl ? false : true;


  try {
    switch (command) {
      case "subscribe":
        {
          const core = new SecureClip({ host, ssl, transport: "socket" }, passphrase);
          const limit = opts.options.n ? parseInt(opts.options.n) : Infinity;
          let count = 0;
          core.render = () => {
            console.log(core.state.plaintext);
            if (++count >= limit) Deno.exit(0);
          };
          await core.connect();
        }
        break;
      case "get":
        {
          const core = new SecureClip({ host, ssl, transport: "post" }, passphrase);
          core.render = () => console.log(core.state.plaintext);
          await core.load();
        }
        break;
      case "set":
        {
          const core = new SecureClip({ host, ssl, transport: "post" }, passphrase);
          const chunks: string[] = [];
          const decoder = new TextDecoder();
          for await (const chunk of Deno.stdin.readable) {
            chunks.push(decoder.decode(chunk));
          }
          const text = chunks.join("");
          await core.stdin({ command: "set-plaintext", body: text });
        }
        break;
    }
  } catch (e) {
    console.log(e);
  }
}

main();

// Catch uncaught synchronous errors
globalThis.addEventListener("error", (event) => {
  console.error("Uncaught error:", event.error);
  console.error("Message:", event.message);
  console.error("File:", event.filename, "Line:", event.lineno);
});

// Catch unhandled promise rejections
globalThis.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled rejection:", event.reason);
});
