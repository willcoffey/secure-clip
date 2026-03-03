# Websocket issue

Currently, I think the socket hibernates after a bit of time, and I think that may mess up the pub
sub system.

specifically, if a page has been open but unused, the socket doesn't disconnect. it doesn't receive
updates to boards. if you type in it, it will set boards.

review
https://github.com/cloudflare/workers-chat-demo
and
https://developers.cloudflare.com/workers/tutorials/deploy-a-realtime-chat-app/

as far as methods, and apply it to PlatformConnector
refactor the class with comments, to be readable, and to hibernate sockets

## Questions

**Q1: Subscription persistence strategy**
When the DO hibernates, `wsHandlers` and `service.handlers` are cleared.
On wake, the WebSocket is still open (client sees no disconnect).
Two options:
- Server: persist subscribed id(s) via `ws.serializeAttachment()` and
  re-register handlers in `webSocketMessage` before processing each msg.
- Client: detect stale state and re-send a `subscribe` command (but how
  does the client know subscriptions were lost without a disconnect?).
Which approach, or both?

---

Persist the subscribed ids

**Q2: Stale-connection detection on the client**
Since Cloudflare keeps the TCP connection alive through hibernation, the
client's `onclose` never fires when the DO loses subscription state.
Should the client send periodic pings and treat a timeout as a signal to
re-subscribe? Or is server-side `serializeAttachment` sufficient on its
own?

---

No, we want hibernation when it makes sense. An idle client it makes sense.

**Q3: Double-close in `webSocketClose`**
`webSocketClose` currently calls `ws.close()`. Cloudflare docs suggest
the WebSocket is already closed when this handler fires — does this
cause an error, or is it a no-op? Should it be removed?

---

keep it but add an @TODO comment on it
