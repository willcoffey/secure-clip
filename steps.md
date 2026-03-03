# Build a deno terminal utility

1. The deno utility should use the same api as the web utility
 - move Crypt and SecureClip to their own file that is deno
   compatible.

2. Build the utility
look to 
~/repos/castle/src/tools/decrypt.ts
~/repos/castle/src/tools/encrypt.ts

for inspiration.

Deno utility should use post requests, and should use it's own version of Crypto
that is shared with html element.

it should get password from env, unless specified with --password

format should be

echo foo | seclip set -d secure-clip.wilcof.workers.dev

or 

seclip -d ... --passphrase "thisandl afjaslkj aslkdj" get

---

SecureClip should have a constructor option for connection type. Websocket or
post. and the "send" function should decide which to use.

---

## Notes

**POST API is already supported by the backend.** `load` and `update`
both work over POST to `/api/ws` (same route). `subscribe`/`unsubscribe`
are WebSocket-only — the CLI only needs `load` (get) and `update` (set),
so POST is sufficient.

**Things to strip from `SecureClip` for the shared file:**
- `location.host` — needs to be a constructor param (e.g. `-d` flag)
- `localStorage` — CLI reads passphrase from env / flag, no persistence
- `document.visibilitychange` listener — browser-only, not needed in CLI
- `render` callback — not needed, CLI just prints to stdout

**`deriveId` is slow by design** (650k PBKDF2 iterations). The CLI will
pause visibly before every get/set. Consider if that's acceptable UX or
if the CLI should warn the user.

** add command line options for 1. setting the id, and 2. printing the id **

**ENV var name not specified.** What should it be? `SECLIP_PASSPHRASE`?

** sounds good **

**`get` output format**: server returns
`{ command: "set-ciphertext", body: { id, ciphertext } }`. The CLI
needs to decrypt `ciphertext` and write plaintext to stdout. Should
invalid HMAC be a non-zero exit code?

** yeah, exit early **

**`set` reads from stdin** — confirm trailing newline should be stripped
before encrypting (echo adds one).

wait for stdin to complete and use all of it

cat foo.txt | seclip set
seclip get > foo2.txt

should result in idientical files
