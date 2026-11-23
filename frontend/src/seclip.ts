import { SecureClip } from "./core.ts";
import encodeQR from "qr";

/** Runtime shim so this runs under both Deno and Node. */
const D = (globalThis as any).Deno;
const argv: string[] = D ? D.args : process.argv.slice(2);
const getEnv = (k: string): string | undefined => (D ? D.env.get(k) : process.env[k]);
const exit = (code: number): never => (D ? D.exit(code) : process.exit(code)) as never;
const stdin = D ? D.stdin.readable : process.stdin;

async function main() {
  const opts = parseCommandLineOptions(argv, {
    d: true,
    passphrase: true,
    n: true,
  });

  if (opts.flags.h || opts.flags.help) {
    console.log(`Secure clipboard CLI.
Usage: seclip [OPTIONS] get|set|subscribe|qr

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
  seclip -d example.com --passphrase swordfish get`);
    return;
  }
  const host = opts.options.d ?? "127.0.0.1:3000";
  const passphrase = opts.options.passphrase ?? getEnv("SECLIP_PASSPHRASE");
  if (!passphrase) throw "ERR: No passphrase. Use --passphrase or set SECLIP_PASSPHRASE";

  const command = opts.operands[0];
  if (command !== "get" && command !== "set" && command !== "subscribe" && command !== "qr") {
    console.error("ERR: command must be get, set, subscribe, or qr");
    exit(1);
  }
  const ssl = opts.flags.nossl ? false : true;


  try {
    switch (command) {
      case "qr":
        console.log(encodeQR(passphrase, "term"));
        break;
      case "subscribe":
        {
          const core = new SecureClip({ host, ssl, transport: "socket" }, passphrase);
          const limit = opts.options.n ? parseInt(opts.options.n) : Infinity;
          let count = 0;
          core.render = (command) => {
            if (command !== "set-plaintext" && command !== "set-ciphertext") return;
            console.log(core.state.plaintext);
            if (++count >= limit) exit(0);
          };
          await core.stdin({ command: "connect" });
        }
        break;
      case "get":
        {
          const core = new SecureClip({ host, ssl, transport: "post" }, passphrase);
          core.render = (command) => {
            if (command === "set-ciphertext" || command === "set-plaintext") {
              console.log(core.state.plaintext);
            }
          };
          // set-passphrase derives the id and fires a load over POST
          await core.stdin({ command: "set-passphrase", body: passphrase });
        }
        break;
      case "set":
        {
          const core = new SecureClip({ host, ssl, transport: "post" }, passphrase);
          const chunks: string[] = [];
          const decoder = new TextDecoder();
          for await (const chunk of stdin) {
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



/** Vendored in my basic command arg parser */
interface CommandLineOptions {
  options: Record<string, string>;
  flags: Record<string, true>;
  leftovers?: string[];
  operands: string[];
}
function parseCommandLineOptions(
  argv: string[],
  optionsWithArguments: Record<string, boolean> | boolean = true,
): CommandLineOptions {
  const options: Record<string, string> = {};
  const operands: string[] = [];
  const flags: Record<string, true> = {};

  let currentFlag = "";

  for (let i = 0; i < argv.length; i++) {
    // If the first character of the string is not '-' then it specifes an operand or a value
    if (argv[i][0] !== "-") {
      //If no options can take arguments treat as operand
      if (optionsWithArguments === false) {
        operands.push(argv[i]);
        //If all options can take arguments check if there is a current flag, treat as flag or operand respectively
      } else if (optionsWithArguments === true) {
        if (currentFlag) {
          options[currentFlag] = argv[i];
          currentFlag = "";
        } else {
          operands.push(argv[i]);
        }
        //If there isn't a current flag or this flag doesn't accept arguments treat as operand
      } else if (!currentFlag || !optionsWithArguments[currentFlag]) {
        operands.push(argv[i]);
      } else {
        options[currentFlag] = argv[i];
        currentFlag = "";
      }
    } else {
      // First two characters = '--' so string is of form --help or similar
      if (argv[i][1] === "-") {
        if (isEqArg(argv[i])) {
          const eq = argv[i].indexOf("=");
          const name = argv[i].substring(2, eq);
          flags[name] = true;
          options[name] = argv[i].substring(eq + 1);
          currentFlag = "";
        } else {
          currentFlag = argv[i].substring(2);
          flags[currentFlag] = true;
        }
      } else {
        //argument is something like '-gzxv' or '-f'
        if (isEqArg(argv[i])) {
          // special case for options specified as -f=-23
          const eq = argv[i].indexOf("=");
          for (let j = 1; j < eq; j++) flags[argv[i][j]] = true;
          if (eq > 1) options[argv[i][eq - 1]] = argv[i].substring(eq + 1);
          currentFlag = "";
        } else {
          for (let j = 1; j < argv[i].length; j++) {
            currentFlag = argv[i][j];
            flags[currentFlag] = true;
          }
        }
      }
    }
  }

  return { flags: flags, options: options, operands: operands };
}

/** Shorthand utility for detecting stuff like --negative=-44 */
function isEqArg(arg: string) {
  return arg.indexOf("=") !== -1;
}
