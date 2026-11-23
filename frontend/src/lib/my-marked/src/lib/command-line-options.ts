/** Copied from castle/src/lib/Util.ts (Util.parseCommandLineOptions) */
export interface CommandLineOptions {
  options: Record<string, string>;
  flags: Record<string, true>;
  leftovers?: string[];
  operands: string[];
}

/** @TODO Errors and edge cases */
export function parseCommandLineOptions(
  argv: string[],
  optionsWithArguments: Record<string, boolean> | boolean = true,
): CommandLineOptions {
  const options: Record<string, string> = {};
  const flags: Record<string, true> = {};
  let leftovers: undefined | string[];

  let currentFlag = "";
  const operands: string[] = [];

  // argv = array of words of command line args
  for (let i = 0; i < argv.length; i++) {
    // A dash by itself means read from stdin
    if (argv[i] == "-") {
      flags["-"] = true;
      continue;
    }

    // a double dash means stop parsing args here and return leftovers
    if (argv[i] == "--") {
      leftovers = argv.slice(i + 1);
      break;
    }

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
        currentFlag = argv[i].substring(2);
        flags[currentFlag] = true;
      } else {
        //argument is something like '-gzxv' or '-f'
        for (let j = 1; j < argv[i].length; j++) {
          currentFlag = argv[i][j];
          flags[currentFlag] = true;
        }
      }
    }
  }

  return { flags: flags, options: options, operands: operands, leftovers };
}
