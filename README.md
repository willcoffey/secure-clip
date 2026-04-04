# Summary
*secure-clip* is a front and backend for an end-to-end encrypted clipboard utility. There is a deno
terminal utility `seclip.ts`, and a progressive web app front end.

Some portions are vibe coded. The intent is to isolate what needs to be trusted and heavily review
that while allowing for vibe coded bits that aren't important. Such as the backed since it only ever
sees the encrypted ciphertext.

# Development
Currently development is not streamlined. I run 3 `package.json` scripts in separate terminal 
windows. No hot reloading support

@TODO - Setup worker dev to proxy assets to vite server for hot reloading

 - `npm run check` - To do type checking on front and backend code
 - `npm run worker` - To run backend worker, which handles API as well as static hosting of 
built assets
 - `npm run build` - Use vite to build the frontend, watching for file changes


# Deployment

# Usage
