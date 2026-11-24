import { DurableObject } from "cloudflare:workers";
import { Handler, Service } from "./Service";
interface Encrypted {
  iv: string;
  ciphertext: string;
}
type Message =
  | { command: "set-passphrase"; body: string }
  | { command: "set-plaintext"; body: string }
  | { command: "set-ciphertext"; body: Encrypted | null }
  | { command: "connect" }
  | { command: "disconnect" }
  | { command: "error"; body: string };

interface Env {
  CLIP_ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
}

interface Command {
  command: string;
  body: Record<string, any>;
}

async function route(
  cmd: Command,
  service: Service,
  sender?: unknown,
): Promise<{ data?: Message } | null> {
  switch (cmd.command) {
    case "load": {
      const raw = await service.load({ id: cmd.body.id });
      return { data: { command: "set-ciphertext", body: raw ? JSON.parse(raw) : null } };
    }
    case "update": {
      try {
        await service.update({
          id: cmd.body.id,
          ciphertext: JSON.stringify(cmd.body.ciphertext),
          sender,
        });
        return {};
      } catch (e: any) {
        return { data: { command: "error", body: e.toString() } };
      }
    }
  }
  return null;
}

/**
 * Cloudflare Durable Object that handles all WebSocket connections and
 * routes commands to the Service layer.
 *
 * WebSocket Hibernation: Cloudflare can hibernate this DO when all WebSockets
 * are idle, clearing all in-memory state. On wake, `webSocketMessage` is
 * called on a fresh instance. To survive this, each WebSocket's subscribed
 * ids are persisted via `ws.serializeAttachment()` and re-registered at the
 * top of every `webSocketMessage` call.
 */
export class PlatformConnector extends DurableObject {
  service: Service;
  // In-memory map of active handler closures per WebSocket.
  // This is rebuilt from ws.deserializeAttachment() after hibernation.
  private wsHandlers = new Map<WebSocket, Array<{ id: string; handler: Handler }>>();

  constructor(ctx: DurableObjectState, env: never) {
    super(ctx, env);
    this.service = new Service(ctx.storage.sql);
  }

  static parseCommand(data: unknown): Command | null {
    if (typeof data !== "object" || !data) return null;
    const { command, body } = data as Record<string, unknown>;
    if (typeof command !== "string") return null;
    if (body !== undefined && (typeof body !== "object" || Array.isArray(body))) return null;
    return { command, body: (body ?? {}) as Record<string, any> };
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    const cmd = PlatformConnector.parseCommand(await request.json().catch(() => null));
    if (!cmd) return new Response("Bad Request", { status: 400 });
    // Restore subscriptions before routing — 'update' triggers notification
    // handlers, and the DO may have woken from hibernation for this request.
    this.restoreAllSubscriptions();
    const result = await route(cmd, this.service);
    if (!result) return new Response("Unknown command", { status: 400 });
    if (result.data) return Response.json(result.data);
    return new Response(null, { status: 204 });
  }

  /**
   * After hibernation, `wsHandlers` is empty on the new DO instance.
   * This re-registers handler closures from the ids persisted on the WebSocket.
   * Skipped if this WebSocket is already registered (same DO instance lifetime).
   */
  private restoreSubscriptions(ws: WebSocket) {
    if (this.wsHandlers.has(ws)) return;
    const ids: string[] = ws.deserializeAttachment() ?? [];
    if (ids.length === 0) return;
    const entries: Array<{ id: string; handler: Handler }> = [];
    for (const id of ids) {
      const handler: Handler = ({ id, ciphertext, sender }) => {
        if (sender !== ws) {
          ws.send(
            JSON.stringify(
              { command: "set-ciphertext", body: JSON.parse(ciphertext) } satisfies Message,
            ),
          );
        }
      };
      entries.push({ id, handler });
      this.service.subscribe({ id, handler });
    }
    this.wsHandlers.set(ws, entries);
  }

  /**
   * Restores subscriptions for all open WebSockets. Must be called before any
   * operation that triggers notification handlers (e.g. service.update),
   * since both HTTP and WebSocket requests can wake a hibernated DO.
   */
  private restoreAllSubscriptions() {
    for (const ws of this.ctx.getWebSockets()) {
      this.restoreSubscriptions(ws);
    }
  }

  async webSocketMessage(ws: WebSocket, message: string) {
    // Restore subscriptions if this is a fresh DO instance (post-hibernation).
    this.restoreAllSubscriptions();
    const cmd = PlatformConnector.parseCommand(JSON.parse(message));
    if (!cmd) return;

    if (cmd.command === "subscribe") {
      const handler: Handler = ({ id, ciphertext, sender }) => {
        if (sender === ws) return;
        ws.send(
          JSON.stringify(
            { command: "set-ciphertext", body: JSON.parse(ciphertext) } satisfies Message,
          ),
        );
      };
      const entries = this.wsHandlers.get(ws) ?? [];
      entries.push({ id: cmd.body.id, handler });
      this.wsHandlers.set(ws, entries);
      this.service.subscribe({ id: cmd.body.id, handler });
      // Persist the updated id list so it survives hibernation.
      ws.serializeAttachment(entries.map((e) => e.id));
      return;
    }

    if (cmd.command === "unsubscribe") {
      const entries = this.wsHandlers.get(ws) ?? [];
      const idx = entries.findIndex((e) => e.id === cmd.body.id);
      if (idx !== -1) {
        this.service.unsubscribe({ id: cmd.body.id, handler: entries[idx].handler });
        entries.splice(idx, 1);
        // Keep persisted ids in sync.
        ws.serializeAttachment(entries.map((e) => e.id));
      }
      return;
    }

    const result = await route(cmd, this.service, ws);
    if (!result) return;
    if (result.data) ws.send(JSON.stringify(result.data));
  }

  async webSocketClose(ws: WebSocket) {
    for (const { id, handler } of this.wsHandlers.get(ws) ?? []) {
      this.service.unsubscribe({ id, handler });
    }
    this.wsHandlers.delete(ws);
    // @TODO: The WebSocket may already be closed when this fires — verify
    // whether this call is a no-op or throws in that case.
    ws.close();
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      const stub = env.CLIP_ROOM.get(env.CLIP_ROOM.idFromName("global"));
      return stub.fetch(request);
    }
    if (url.pathname === "/favicon.ico") {
      return Response.redirect(new URL("/icon-48x48.png", request.url).href, 301);
    }
    return env.ASSETS.fetch(request);
  },
};

function sleep(ms: number) {
  return new Promise((res) => {
    setTimeout(res, ms);
  });
}
