# Implementation Steps

## Frontend

- Default id/password to `swordfish` on load
- On connect, send `{ endpoint: "load", body: { id } }` to fetch
  existing ciphertext, then decrypt and populate textarea
- Change WS message shape to `{ endpoint: string, body?: object }`

## Backend

- Parse incoming WS messages as `{ endpoint: string, body?: object }`
- Route `endpoint` to handlers: `"load"` | `"update"` | `"subscribe"`
  - `load`: fetch ciphertext by id, send back to caller only
  - `update`: store ciphertext, broadcast to all subscribers
  - `subscribe`: register client to receive updates for an id
- Keep routing logic separate from the HTTP upgrade handler
