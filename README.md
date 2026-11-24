# Summary
*secure-clip* is a front and backend for an end-to-end encrypted clipboard utility. There is a deno
terminal utility `seclip.ts`, and a progressive web app front end. It uses symmetric key encryption,
AES-GCM, with QR codes as a convenient way to share keys.

The purpose of this tool is to provide a safe, low overhead way of sharing short bits of text
between devices, without any accounts, on free self-hosted Cloudflare workers. Some use cases
include:

 - Piping logs, text, etc. from the terminal to the clipboard
   ```
   tail -n 50 server.log | seclip -d URL --passphrase PASSPHRASE set
   ```
 - Integrating with vim so it can be used akin to a register.
 - Giving Claude access so it can send and read. Useful for sandboxed agents, or for summaries
   during ongoing tasks.
 - Quickly sharing text to phone or between people via qr code

`core.ts` contains minimal client + encryption logic.

# Installation
The terminal utility is a single Deno script. Run it directly:
```
deno run --allow-net --allow-env frontend/src/seclip.ts -h
```

Or install it globally as `seclip`:
```
deno install -g --allow-net --allow-env -n seclip frontend/src/seclip.ts
```

It also runs under Node (>= 22.18, which strips TS types natively) with no flags
or build step:
```
node frontend/src/seclip.ts -h
```

# Usage
## Terminal
Help can be shown via `seclip -h`, to read data in a specific clipboard run 
`seclip get -d URL --passphrase PASSPHRASE`. The passphrase can be omitted if the `SECLIP_PASSPHRASE`
env variable is set, and `-d` can be omitted if `SECLIP_HOST` is set.

To set the contents of a board text can be piped to it via `echo "hello" | seclip set -d URL 
--passphrase PASSPHRASE`. For ease of use I add the two aliases and the env variable to my 
to my `.bashrc`
```
export SECLIP_PASSPHRASE="swordfish"
export SECLIP_HOST="<salt>.<account>.workers.dev"
alias setclip='seclip set'
alias getclip='seclip get'
```

In addition to one off reads, a board can be subscribed to receive updates whenever that board 
changes.
`seclip subscribe -d URL --passphrase PASSPHRASE`.


## Web App
The webapp is a simple text area that displays the contents of the clipboard and updates it on 
change. The control bar at the top contains
 - The passphrase field, which gets stored in browser local storage.
 - Generate a new passphrase
 - Display the passphrase as a QR code, for synchronizing devices without needing to type.
 - Toggle markdown parsing, done in a sandboxed iframe so no image or other external embeds.
 - Display connection status, and click to toggle connection status.
 - Toggles help to be displayed on or off.


## Claude
I added a brief section to my `CLAUDE.md` to explain how to use the tool. Whenever I want I can tell
claude to look at my clipboard, or send data to it. This is particularly useful when you have your
agent heavily sandboxed. So this is a quick easy way to get data in and out in a controlled fashion.

I will often prompt similarly to:
```
review the cloudflare docs on how websockets are hibernated. Summarize the serialization and 
deserialization process in 50 lines or less, and link most relevant cloudflare docs. Send the 
result to seclip.
```

Inside my global `CLAUDE.md` I have
```
## Clipboard Tool
Use `seclip` to send data to the user's clipboard.

- Get current value: `seclip -d HOST get`
- Set a value: `echo "..." | seclip -d HOST set`
- Use `seclip -h` for additional options

Default host: `HOST`
```

## VIM
In my `.vimrc` I have a couple short functions for copying and pasting to the clipboard. `vv` will
paste whatever the contents are (passphrase is an env var). `cc` will send the current selection
to the clipboard.
```
" Get contents of seclip clipboard, store it in c register, and put it.
function s:GetWebClipboard()
  let @c = system("seclip -d HOST get")
  exec "normal! \"cp"
endfunction
nnoremap <silent> vv :call <SID>GetWebClipboard()<CR>


" Store visual selection in seclip clipboard.
function s:PutWebClipboard() range
  let val = s:get_visual_selection()
  call system("seclip -d HOST set", val)
endfunction
"https://stackoverflow.com/questions/1533565/how-to-get-visually-selected-text-in-vimscript
function s:get_visual_selection()
    " Why is this not a built-in Vim script function?!
    let [line_start, column_start] = getpos("'<")[1:2]
    let [line_end, column_end] = getpos("'>")[1:2]
    let lines = getline(line_start, line_end)
    if len(lines) == 0
        return ''
    endif
    let lines[-1] = lines[-1][: column_end - (&selection == 'inclusive' ? 1 : 2)]
    let lines[0] = lines[0][column_start - 1:]
    return join(lines, "\n")
endfunction
vnoremap <silent> cc :call <SID>PutWebClipboard()<CR>
```

# Security Model
The architecture of this app is designed to assume that the server is untrusted. It's set up such
that the server never sees plaintext, but only encrypted ciphertext and derived ids. It's assumed
anything on the server (metadata, board size, board id, etc) is public.

So long as the password is secure, such as any generated via the dice button, plaintext should never
be exposed.

 - The user provided passphrase is run through `650000` iterations of `PBKDF2`
 - `HKDF` is used to generate key and id from the pbkdf2 derivation
 - The text is encrypted with `AES-GCM` and submitted to the server

The salt used for `PBKDF2` is a hardcoded value, which is needed to ensure that the derived ids are
deterministic.

Passphrase is stored in local storage - necessary for viewing and remembering the passphrase.

## Weaknesses
There are some issues that could be resolved during a hardening phase

 - There is no mechanism to sign the client. A malicious server could simply serve a different
   client.
 - Markdown parsing could leak via dns, or possibly other mechanisms. It does use iframe sandboxing
   and requires the user to click the button.
 - Metadata leakage is inherent to the model.
 - The salt should be a config entry and unique to each deploy. For now I'm only ever running a
   single instance.
 - Nothing deals with message order, like a chain of hashes. A MITM could send boards out of order.

## Fixes
 - I should make the ciphertext signed by the key, so that you can't overwrite boards without
   knowing the key. Currently you could with just the id and random values. Though this is something
   where the server can always evict or overwrite, and decryption uses AES-GCM which handles integrity,
   so it's not adding anything additional when you assume untrusted server.

# Development
## Quick Start
```
git clone https://github.com/willcoffey/secure-clip
npm install
```

Then, there are 3 scripts I will have running during development:
 - `npm run check` To watch for changes while typechecking front/backend.
 - `npm run build` Watch for changes and rebuild assets
 - `npm run worker` Run the cloudflare worker locally, which hosts the static assets and API.

The worker can also be deployed to cloudflare workers for free via `npm run deploy`. See relevant
cloudflare docs for `wrangler` setup and worker details.
