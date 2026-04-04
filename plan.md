# Connection Icon Click Behaviour

Clicking the globe icon should toggle the connection.
Disconnected → connect, connected/connecting → disconnect.
The action routes through `stdin` like all other state changes.

## 1. Add actions to Message type (core.ts)

```ts
export type Message =
  | { action: "set-passphrase"; args: string }
  | { action: "set-plaintext"; args: string }
  | { action: "set-ciphertext"; args: EncryptedData }
  | { action: "connect" }
  | { action: "disconnect" };
```

## 2. Handle in stdin (core.ts)

```ts
case "connect":
  this.connect();
  break;
case "disconnect":
  this.disconnect();
  break;
```

## 3. Make button interactive (secure-clip.css)

Remove `pointer-events: none` and `cursor: default` from
`#passphrase-connect`. The existing hover style already covers
interactive buttons, so add it back to the hover selector too.

## 4. Wire click handler (secure-clip.ts)

```ts
passphraseConnect.addEventListener("click", () => {
  const action = this.core.connectionStatus === "disconnected"
    ? "connect"
    : "disconnect";
  this.core.stdin({ action });
});
```
