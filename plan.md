# Type Unification: Message

## Goal

One `Message` type shared by both client and server. Either side can send
any command; each side handles what it knows. `ServerMessage` is deleted.
`Message` becomes the wire protocol type and is imported by index.ts.

## core.ts changes (minimal)

Two changes only:

1. Rename fields: `action` → `command`, `args` → `body` in the `Message`
   union. Update the `stdin()` switch to match.

2. Extend `Message` with the commands the server receives from the client
   (currently not in the union):
   ```ts
   | { command: "load"; body: { id: string } }
   | { command: "update"; body: { id: string; ciphertext: Encrypted } }
   | { command: "subscribe"; body: { id: string } }
   | { command: "unsubscribe"; body: { id: string } }
   ```
   These complete the symmetric picture. `stdin()` does not need to handle
   them — the default/unmatched branch covers it.

3. Delete the `ServerMessage` interface. It is replaced by `Message`.

---

## index.ts changes

### 1. Import `Message` from core.ts, remove local `Command`

```ts
import type { Message } from "../frontend/src/core.ts";
```

Delete `interface Command { ... }` (lines 19–22). Replace every use of
`Command` with `Message`.

### 2. Update `validate()` return type

```ts
validate(data: unknown): Message | null
```

The internal cast stays structural — `validate()` checks shape, not
variant. Callers use the discriminated union for narrowing.

### 3. Update `route()` signature

```ts
async function route(
  cmd: Message,
  service: Service,
  ctx: ... = ...,
): Promise<{ data?: Message; error?: string } | null>
```

Both input and output are `Message`. The return `data` is now typed
instead of `object`.

### 4. Type `ws.send()` literals as `Message`

In `restoreSubscriptions` and `webSocketMessage`, assign before
stringifying so the compiler checks the shape:

```ts
const msg: Message = {
  command: "set-ciphertext",
  body: { id, ciphertext: JSON.parse(ciphertext) },
};
ws.send(JSON.stringify(msg));
```
