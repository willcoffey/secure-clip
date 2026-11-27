import { Crypt, SecureClip } from "./core.ts";
import { assertSeclipOptions, parseSeclipOptions } from "./lib/util.ai.ts";
import encodeQR from "qr";

function showHelp() {
  console.log(`Secure clipboard CLI.
Usage: seclip [OPTIONS] get|set|subscribe|qr|url|dice

COMMANDS
  get                     Loads value from board
  set                     Saves value to board
  subscribe               Connects with a socket and streams out board updates
  qr                      Prints a scannable qr code in the terminal
  url                     Logs the url for the board (same value as qr)
  dice                    Generate a random passphrase

OPTIONS
  -h, --help              Print help
  -d [URL]                URL (-d, SECLIP_HOST)
  --passphrase [PHRASE]   Passphrase (--passphrase, SECLIP_PASSPHRASE)
  --salt [SALT]           Salt (--salt, -d URL, SECLIP_SALT, SECLIP_HOST)
  -n [COUNT]              (subscribe) Exit after receiving COUNT messages
  --with-passphrase       (qr, url) Include the passphrase in the URL

Examples:
  seclip get
  echo "hello" | seclip set
  seclip subscribe
  seclip -n 1 subscribe
  seclip -d example.com/SERVER_PATH#s=SALT --passphrase swordfish get
  export SECLIP_PASSPHRASE=\$(seclip dice)`);
}

async function main() {
  try {
    const opts = parseCommandLineOptions(process.argv.slice(2), {
      d: true,
      passphrase: true,
      salt: true,
      n: true,
    });
    if (opts.flags.h || opts.flags.help) return showHelp();
    if (opts.operands[0] === "dice") {
      return console.log(Crypt.uint8ArrayToBase64(Crypt.randomBytes(16), false));
    }
    const fullOptions = parseSeclipOptions(
      opts,
      process.env,
      ["get", "set", "subscribe", "qr", "url"],
    );
    const { host, ssl, salt, passphrase, command } = fullOptions;

    switch (command) {
      case "qr":
      case "url": {
        const withPassphrase = !!opts.flags["with-passphrase"];
        if (withPassphrase) assertSeclipOptions(fullOptions, "salt", "passphrase");
        else assertSeclipOptions(fullOptions, "salt");
        const fragment = new URLSearchParams({ s: salt, ...(withPassphrase && { p: passphrase }) });
        const url = `${ssl ? "https" : "http"}://${host}/#${fragment}`;
        console.log(command === "qr" ? encodeQR(url, "term") : url);
        return;
      }
      case "subscribe":
        assertSeclipOptions(fullOptions, "passphrase", "salt");
        {
          const core = new SecureClip({ host, ssl, salt, transport: "socket" }, passphrase);
          const limit = opts.options.n ? parseInt(opts.options.n) : Infinity;
          let count = 0;
          core.render = (command) => {
            if (command !== "set-plaintext" && command !== "set-ciphertext") return;
            process.stdout.write(core.state.plaintext);
            if (++count >= limit) process.exit(0);
          };
          await core.stdin({ command: "connect" });
        }
        break;
      case "get":
        assertSeclipOptions(fullOptions, "passphrase", "salt");
        {
          const core = new SecureClip({ host, ssl, salt, transport: "post" }, passphrase);
          core.render = (command) => {
            if (command === "set-ciphertext" || command === "set-plaintext") {
              process.stdout.write(core.state.plaintext);
            }
          };
          await core.stdin({ command: "set-passphrase", body: passphrase });
        }
        break;
      case "set":
        assertSeclipOptions(fullOptions, "passphrase", "salt");
        {
          const core = new SecureClip({ host, ssl, salt, transport: "post" }, passphrase);
          const chunks: string[] = [];
          const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
          for await (const chunk of process.stdin) {
            chunks.push(decoder.decode(chunk, { stream: true }));
          }
          chunks.push(decoder.decode());
          const text = chunks.join("");
          await core.stdin({ command: "set-plaintext", body: text });
          if (core.state.error) throw new Error(core.state.error);
        }
        break;
    }
  } catch (e) {
    console.error(e);
    process.exit(1);
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
