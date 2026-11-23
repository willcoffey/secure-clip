#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { text } from "node:stream/consumers";
import { parseCommandLineOptions } from "./lib/command-line-options.ts";
import { parse } from "./markdown_compiler.ts";

function help() {
  console.log(`    my-marked
    Compiles markdown to HTML and writes it to stdout. Reads stdin unless -f is given.
    Usage: my-marked [OPTIONS]

    -h --help Print this help
    -f [FILENAME] Read markdown from file instead of stdin
`);
}

async function main() {
  const args = parseCommandLineOptions(process.argv.slice(2), { f: true });
  if (args.flags.h || args.flags.help) return help();

  const markdown = args.options.f ? await readFile(args.options.f, "utf8") : await text(process.stdin);
  process.stdout.write(await parse(markdown));
}
main();
