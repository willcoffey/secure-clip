# Summary
*secure-clip* is a front and backend for an end-to-end encrypted clipboard utility. There is a deno
terminal utility `seclip.ts`, and a progressive web app front end. It uses symmetric key encryption,
AES-GCM, with QR codes as a convenient way to share keys locally.

This project started as a means to learn Claude code and Cloudflare workers, but has become a tool
that I use every day. It's designed to be self-hostable for free as a Cloudflare Durable Worker.

`core.ts` contains minimal client + encryption logic. Can be tested in isolation to verify security.

# Usage
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
## Terminal
One of the key reasons I built this was because of the consistent annoyance I've had with copying
text to and from the terminal. With `seclip` it's easy to just send a file to the clipboard via
`cat foo.txt | seclip set`. `seclip` does need to be installed on the host machine, which I do via
deno. I expect that building a shell script that uses `openssl` would be a great AI target since all
the test framework is already there.

## Claude
I added a brief section to my `CLAUDE.md` to explain how to use the tool. Whenever I want I can tell
claude to look at my clipboard, or send data to it. This is Particularly useful when you have your
agent heavily sandboxed. So this is a quick easy way to get data in and out in a controlled fashion.

I will often prompt similarly to:
```
review the cloudflare docs on how websockets are hibernated. Summarize the serialization and 
deserizalization process in 50 lines or less, and link most relevent cloudflare docs. Send the 
result to seclip.
```

Inside my gloval `CLAUDE.md` I have
```
## Clipboard Tool
Use `seclip` to send data to the user's clipboard.

- Get current value: `seclip -d secure-clip.wilcof.workers.dev get`
- Set a value: `echo "..." | seclip -d secure-clip.wilcof.workers.dev set`
- Use `seclip -h` for additional options

Default host: `secure-clip.wilcof.workers.dev`
```

## Sharing
When I just need to share some text with someone in person, I'll often have them load the PWA. 
Then I'll randomize my passphrase and have them scan the QR code. No accounts, no apps. You get 
biderectional sharing of text between as many people as you want.

I also use it to run prompts on someones behalf. I can tell Claude
```
Read google workspace docs and outline the process of creating a new user. send the basic steps
as well as references to seclip with the passphrase "googlesetup"
```

and have them just type in the passphrase to get the steps.



## Misc
I like to make shopping lists on my laptop, but then look at them in the store on my phone. So I 
use this.

# Development
## Quick Start
I run 3 scripts in seperate terminal windows:

Watch for changes and typecheck front and backend
`npm run check`

Watch for changes and build static assets using vite
`npm run check`

Run the local dev server which hosts static assets and backend API
`npm run worker`

## Overview
There are some key ideas I'm trying to follow during development, for AI based development as well
as frontend development.

 - Thoroughly reviewing AI code quickly becomes a bottleneck. I attempt to mitigate this by limiting
the risk of AI code. In this case, the backend only sees encrypted ciphertext and runs on it's own
worker instance. There is no risk of the backend code leaking any clipboard contents. Backend risk
is essentially just running through the free tier worker requests. If it was connected to billing
that could be a bigger concern.

 - Frontend rendering code should be seperate from the client. The terminal utility should share the
same code as the PWA. This both enforces good code practices vis-a-vis forced seperation of DOM
specific code, and serves as a way to give Agents a simple way to interact with the backend for
testing and usage.

# Deployment
@TODO - Walk through process of login, create worker, etc.
`npm run deploy`

# Possible Feature
 - Dev: proxy to vite server for hot reloading
 - append endpoint in addition to set
 - QR Code scanning
 - In browser markdown parsing
 - Better reconnection logic
