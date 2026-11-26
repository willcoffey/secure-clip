/**
 * AI-generated utility functions.
 *
 * Rules for anything added to this file:
 *
 * - Pure functions only: the output depends solely on the arguments,
 *   and the same arguments always give the same result.
 * - No side effects: no I/O, DOM, network, storage or logging, no
 *   mutation of arguments or module-level state.
 * - No ambient or non-deterministic inputs: no setTimeout/setInterval,
 *   Date.now(), new Date(), Math.random(), crypto.getRandomValues()
 *   or similar. If a function needs the time or randomness, take it
 *   as a parameter.
 */

/**
 * seclip CLI settings from the parsed command line and environment. The
 * URL (-d, else SECLIP_HOST) looks like [https://]host/<server_path>#s=<salt>;
 * the fragment never reaches the server. The scheme picks the transport:
 * http:// is plain http/ws, https:// or none is https/wss.
 * Salt priority: --salt, SECLIP_SALT, URL.
 * Passphrase priority: --passphrase, SECLIP_PASSPHRASE; "" if neither.
 * command is the first operand; throws unless it is one of commands, so
 * the returned command is typed as that union.
 *
 * Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
 */
export function parseSeclipOptions<C extends string>(
  cli: { options: Record<string, string>; flags: Record<string, true>; operands: string[] },
  env: Record<string, string | undefined>,
  commands: readonly C[],
): { host: string; ssl: boolean; salt: string; passphrase: string; command: C } {
  const command = cli.operands[0] as C;
  if (!commands.includes(command)) throw `ERR: command must be one of ${commands.join(", ")}`;
  const d = cli.options.d ?? env.SECLIP_HOST ?? "http://127.0.0.1:3000";
  const url = new URL(/^https?:\/\//i.test(d) ? d : `https://${d}`);
  const fragmentSalt = new URLSearchParams(url.hash.slice(1)).get("s");
  return {
    host: url.host + url.pathname.replace(/\/$/, ""),
    ssl: url.protocol === "https:",
    salt: cli.options.salt ?? env.SECLIP_SALT ?? fragmentSalt ?? "",
    passphrase: cli.options.passphrase ?? env.SECLIP_PASSPHRASE ?? "",
    command,
  };
}

const MISSING_OPTION_ERRORS = {
  passphrase: "ERR: No passphrase. Use --passphrase or set SECLIP_PASSPHRASE",
  salt: "ERR: No salt. Use --salt, SECLIP_SALT, or URL#s=SALT",
} as const;

/**
 * Throws the matching error for the first of the required options that is
 * empty. Without a salt the CLI would silently derive ids for the wrong
 * boards, so every command that talks to the server should require it.
 *
 * Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
 */
export function assertSeclipOptions(
  options: { passphrase: string; salt: string },
  ...required: Array<keyof typeof MISSING_OPTION_ERRORS>
): void {
  for (const key of required) {
    if (!options[key]) throw MISSING_OPTION_ERRORS[key];
  }
}

