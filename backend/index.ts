import { DurableObject } from "cloudflare:workers";
import { Service, Handler } from "./Service";

interface Env {
  CLIP_ROOM: DurableObjectNamespace;
}

interface Command {
  command: string;
  body: Record<string, string>;
}

async function route(
  cmd: Command,
  service: Service,
): Promise<{ data?: object; error?: string } | null> {
  switch (cmd.command) {
    case "load": {
      const ciphertext = await service.load({ id: cmd.body.id });
      return { data: { command: "load", body: { id: cmd.body.id, ciphertext } } };
    }
    case "update": {
      try {
        await service.update({ id: cmd.body.id, ciphertext: cmd.body.ciphertext });
        return {};
      } catch (e: any) {
        return { error: e.message };
      }
    }
  }
  return null;
}

export class PlatformConnector extends DurableObject {
  service: Service;
  private wsHandlers = new Map<WebSocket, Array<{ id: string; handler: Handler }>>();

  constructor(ctx: DurableObjectState, env: never) {
    super(ctx, env);
    this.service = new Service(ctx.storage.sql);
  }

  validate(data: unknown): Command | null {
    if (typeof data !== "object" || !data) return null;
    const { command, body } = data as Record<string, unknown>;
    if (typeof command !== "string") return null;
    if (body !== undefined && (typeof body !== "object" || Array.isArray(body))) return null;
    return { command, body: (body ?? {}) as Record<string, string> };
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    const cmd = this.validate(await request.json().catch(() => null));
    if (!cmd) return new Response("Bad Request", { status: 400 });
    const result = await route(cmd, this.service);
    if (!result) return new Response("Unknown command", { status: 400 });
    if (result.error) return Response.json({ error: result.error }, { status: 400 });
    if (result.data) return Response.json(result.data);
    return new Response(null, { status: 204 });
  }

  async webSocketMessage(ws: WebSocket, message: string) {
    const cmd = this.validate(JSON.parse(message));
    if (!cmd) return;
    if (cmd.command === "subscribe") {
      const handler: Handler = ({ id, ciphertext }) => {
        ws.send(JSON.stringify({ command: "update", body: { id, ciphertext } }));
      };
      const entries = this.wsHandlers.get(ws) ?? [];
      entries.push({ id: cmd.body.id, handler });
      this.wsHandlers.set(ws, entries);
      this.service.subscribe({ id: cmd.body.id, handler });
      return;
    }
    const result = await route(cmd, this.service);
    if (!result) return;
    if (result.data) ws.send(JSON.stringify(result.data));
    else if (result.error) ws.send(JSON.stringify({ error: result.error }));
  }

  async webSocketClose(ws: WebSocket) {
    for (const { id, handler } of this.wsHandlers.get(ws) ?? []) {
      this.service.unsubscribe({ id, handler });
    }
    this.wsHandlers.delete(ws);
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
    return new Response("Not found", { status: 404 });
  },
};
