# Usage Notes

createa a brief usage.md file.
this will be imported into the backend and returned as the contents of system-help

should be brief explanation + usage with examples.

note use cases
 create grocery list on pc, read on phone at store
 send vim registers to command, bypassing copying from terminal
 useage on remote server

## Questions

**Q1: Location of usage.md**
Root of the repo (doubles as docs), or somewhere else like `backend/`?

**Q2: Importing .md in the Worker**
Cloudflare Workers are bundled by wrangler/esbuild, not Vite — `?raw`
imports don't work. Wrangler supports text module rules in wrangler.toml:
```toml
[[rules]]
type = "Text"
globs = ["**/*.md"]
```
This lets the backend do `import HELP from "../usage.md"`. Okay to add
this rule, or prefer a different approach (e.g. inline the text in a
.ts file)?
