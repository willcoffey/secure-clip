# Plan: update callers to render(command: string)

`core.ts` changed `render` from `() => void` to `(command: string) => void`.
Two files assign `core.render` and need updating.

---

## seclip.ts

Three `core.render` assignments, all ignore the argument today.

**subscribe** (line 48)
```ts
core.render = () => { ... }
```
Change to `(command) =>`. Only print when the command is a content update,
not connection events:
```ts
core.render = (command) => {
  if (command !== "set-plaintext" && command !== "set-ciphertext") return;
  console.log(core.state.plaintext);
  if (++count >= limit) Deno.exit(0);
};
```

**get** (line 58)
```ts
core.render = () => console.log(core.state.plaintext);
```
Transport is `post` so the only render trigger will be the load response,
but guard anyway for consistency:
```ts
core.render = (command) => {
  if (command === "set-ciphertext" || command === "set-plaintext") {
    console.log(core.state.plaintext);
  }
};
```

**set** — no `render` assigned, no change needed.

---

## secure-clip.ts

`render` is assigned in `initTextarea` (line 57):
```ts
this.core.render = () => {
  textarea.value = this.core.state.plaintext;
};
```
Change signature and gate textarea update on content commands.
Connection events (`socket-open`, `socket-close`) should not overwrite
textarea since `state.plaintext` is cleared on disconnect:
```ts
this.core.render = (command) => {
  if (command === "set-plaintext" || command === "set-ciphertext") {
    textarea.value = this.core.state.plaintext;
  }
};
```
The connection UI (globe icon, disabled state) is already handled via
`onConnectionChange` — wait, that was removed. Connection rendering now
comes through `render("socket-open")` / `render("socket-close")`.
The button/field enable/disable logic that was in `onConnectionChange`
needs to move into `render`:
```ts
this.core.render = (command) => {
  if (command === "set-plaintext" || command === "set-ciphertext") {
    textarea.value = this.core.state.plaintext;
  } else if (command === "socket-open" || command === "socket-close") {
    const connected = this.core.state.connected;
    passphraseConnect.classList.toggle("connected", connected);
    passphraseConnect.classList.toggle("disconnected", !connected);
    passphraseConnect.innerHTML = connected ? globe : globeOff;
    passphraseField.disabled = !connected;
    textarea.disabled = !connected;
  }
};
```
And remove the `onConnectionChange` assignment block (lines 121–127).
