# Summary
*secure-clip* is a front and backend for an end-to-end encrypted clipboard utility. There is a deno
terminal utility `seclip.ts`, and a progressive web app front end. It uses symmetric key encryption,
AES-GCM, with QR codes as a convenient way to share keys.

This project started as a means to learn Claude Code and Cloudflare Workers, but has become a tool
that I use daily. It's designed to be self-hostable for free as a Cloudflare Durable Worker. I use
it for:
 
 - copying text from a machine using `cat foo.txt | seclip set --passphrase swordfish -d URL`
 - keybindings in `vim` to copy the selected text, or paste from the `seclip`.
 - simple shopping lists or task lists made on laptop to be accessible on phone without overhead.

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
env variable is set.

To set the contents of a board text can be piped to it via `echo "hello" | seclip set -d URL 
--passphrase PASSPHRASE`. For ease of use I add the two aliases and the env variable to my 
to my `.bashrc`
```
export SECLIP_PASSPHRASE="swordfish"
alias setclip='seclip -d secure-clip.wilcof.workers.dev set'
alias getclip='seclip -d secure-clip.wilcof.workers.dev get'
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
 - Display connection status, and click to toggle connection status.
 - Display additional help. Loads a system board, refresh the page to go back to user board.


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

- Get current value: `seclip -d secure-clip.wilcof.workers.dev get`
- Set a value: `echo "..." | seclip -d secure-clip.wilcof.workers.dev set`
- Use `seclip -h` for additional options

Default host: `secure-clip.wilcof.workers.dev`
```

## VIM
In my `.vimrc` I have a couple short functions for copying and pasting to the clipboard. `vv` will
paste whatever the contents are (passphrase is an env var). `cc` will send the current selection
to the clipboard.
```
" Get contents of seclip clipboard, store it in c register, and put it.
function s:GetWebClipboard()
  let @c = system("seclip -d secure-clip.wilcof.workers.dev get")
  exec "normal! \"cp"
endfunction
nnoremap <silent> vv :call <SID>GetWebClipboard()<CR>


" Store visual selection in seclip clipboard.
function s:PutWebClipboard() range
  let val = s:get_visual_selection()
  call system("seclip -d secure-clip.wilcof.workers.dev set", val)
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
The main intent behind this is to avoid having to trust the server with any secrets, or trust any
server side code which gives more freedom for using LLM generated code on the server.

 - The user provided passphrase is run through `650000` iterations of `PBKDF2` 
 - `HKDF` is used to generate key and id from the pbkdf2 derivation
 - The text is encrypted with `AES-GCM` and submitted to the server along with the id. The server 
   sees the derived id, ciphertext, and of course metadata such as ciphertext size and request 
   timing.

The salt used for `PBKDF2` is a hardcoded value, which is needed to ensure that the derived ids are
deterministic. A user only needs the passphrase to be able to lookup if a board exists on the server
that matches.

Currently the timestamp is not part of the ciphertext, a malicious server could record 
encrypted messages and send them out of order.

Passphrase is stored in local storage - necessary for viewing and remembering the passphrase

The system is built to be agnostic as to where commands come from. Remote server or user. This can
lead to a malicious server being able to use the clients browser as an encryption oracle, and 
AES-GCM is vulnerable to nonce repeat. With 96 bit nonce I don't think it's an issue with network
latency but it should eventually be addressed. AES-GCM-SIV is not in web crypto.



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

## Overview
There are some key ideas I'm trying to follow during development, for AI based development as well
as frontend development.

 - Thoroughly reviewing AI code quickly becomes a bottleneck. I attempt to mitigate this by limiting
the risk of AI code. In this case, the backend only sees encrypted ciphertext and runs on its own
worker instance. There is no risk of the backend code leaking any clipboard contents. Backend risk
is essentially just running through the free tier worker requests. If it was connected to billing
that could be a bigger concern.

 - Frontend rendering code should be separate from the client. The terminal utility should share the
same code as the PWA. This both enforces good code practices vis-a-vis forced separation of DOM
specific code, and serves as a way to give Agents a simple way to interact with the backend for
testing and usage.
