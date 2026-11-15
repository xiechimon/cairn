interface Env {
  RELAY: DurableObjectNamespace;
  HOST_CAPABILITY?: string;
  CLIENT_CAPABILITY?: string;
}

interface Connection {
  id: string;
  role: 'host' | 'client';
  hostId: string;
  expiresAt: number;
  retired: boolean;
  window: number;
  received: number;
  sent: number;
}

const encoder = new TextEncoder();
const socketBudget = 1024 * 1024;
const roomBudget = 8 * socketBudget;

function admission(request: Request, env: Env): Response | Connection['role'] {
  const url = new URL(request.url);
  if (
    url.search ||
    request.headers.has('Origin') ||
    request.headers.has('Sec-WebSocket-Protocol')
  ) {
    return new Response(null, { status: 400 });
  }
  if (url.pathname !== '/connect/host' && url.pathname !== '/connect/client') {
    return new Response(null, { status: 404 });
  }
  if (request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return new Response(null, { status: 426 });
  }
  const host = env.HOST_CAPABILITY;
  const client = env.CLIENT_CAPABILITY;
  if (
    !host ||
    !client ||
    !/^[a-f0-9]{64}$/.test(host) ||
    !/^[a-f0-9]{64}$/.test(client) ||
    host === client
  ) {
    return new Response(null, { status: 503 });
  }
  const role = url.pathname === '/connect/host' ? 'host' : 'client';
  const expected = encoder.encode(`Bearer ${role === 'host' ? host : client}`);
  const actual = encoder.encode(request.headers.get('Authorization') ?? '');
  if (
    actual.byteLength !== expected.byteLength ||
    !crypto.subtle.timingSafeEqual(actual, expected)
  ) {
    return new Response(null, { status: 401 });
  }
  return role;
}

export class PersonalRelay implements DurableObject {
  constructor(
    private ctx: DurableObjectState,
    private env: Env,
  ) {
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS budget (id INTEGER PRIMARY KEY CHECK(id = 1), sent INTEGER NOT NULL)',
    );
    ctx.storage.sql.exec('INSERT OR IGNORE INTO budget VALUES (1, 0)');
  }

  private connection(ws: WebSocket): Connection {
    return ws.deserializeAttachment() as Connection;
  }

  private retire(ws: WebSocket, code: number): void {
    const state = this.connection(ws);
    const wasRetired = state.retired;
    state.retired = true;
    ws.serializeAttachment(state);
    if (ws.readyState !== WebSocket.CLOSED) ws.close(code, 'Relay session ended');
    if (wasRetired) return;
    if (state.role === 'host') {
      for (const peer of this.ctx.getWebSockets()) {
        const child = this.connection(peer);
        if (child.role === 'client' && child.hostId === state.id) this.retire(peer, code);
      }
    }
  }

  private live(ws: WebSocket): boolean {
    const state = this.connection(ws);
    if (state.retired) return false;
    if (state.expiresAt <= Date.now() || ws.readyState !== WebSocket.OPEN) {
      this.retire(ws, 1008);
      return false;
    }
    return true;
  }

  private totalSent(): number {
    return this.ctx.storage.sql.exec<{ sent: number }>('SELECT sent FROM budget WHERE id = 1').one()
      .sent;
  }

  private send(destination: WebSocket, envelope: object, sender?: WebSocket): void {
    if (!this.live(destination) || (sender && !this.live(sender))) return;
    const text = JSON.stringify(envelope);
    const bytes = encoder.encode(text).byteLength;
    const state = this.connection(destination);
    const total = this.totalSent();
    if (state.sent + bytes > socketBudget || total + bytes > roomBudget) {
      if (total + bytes > roomBudget)
        this.ctx.storage.sql.exec('UPDATE budget SET sent = ? WHERE id = 1', roomBudget);
      this.retire(destination, 1013);
      if (sender) this.retire(sender, 1013);
      return;
    }
    this.ctx.storage.sql.exec('UPDATE budget SET sent = sent + ? WHERE id = 1', bytes);
    state.sent += bytes;
    destination.serializeAttachment(state);
    try {
      destination.send(text);
    } catch {
      this.retire(destination, 1011);
      if (sender) this.retire(sender, 1011);
    }
  }

  fetch(request: Request): Response {
    const role = admission(request, this.env);
    if (role instanceof Response) return role;
    const sockets = this.ctx.getWebSockets();
    const host = sockets.find((ws) => this.connection(ws).role === 'host' && this.live(ws));
    if (this.totalSent() >= roomBudget) return new Response(null, { status: 503 });
    if (role === 'host' && host) return new Response(null, { status: 409 });
    if (role === 'client' && !host) return new Response(null, { status: 503 });
    if (sockets.filter((ws) => ws.readyState !== WebSocket.CLOSED).length >= 17) {
      return new Response(null, { status: 429 });
    }
    const pair = new WebSocketPair();
    const id = crypto.randomUUID();
    const now = Date.now();
    const state: Connection = {
      id,
      role,
      hostId: host ? this.connection(host).id : id,
      expiresAt: now + 3_600_000,
      retired: false,
      window: Math.floor(now / 60_000),
      received: 0,
      sent: 0,
    };
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment(state);
    this.send(pair[1], { v: 1, type: 'welcome', role, id });
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    if (!this.live(ws)) return;
    const state = this.connection(ws);
    const window = Math.floor(Date.now() / 60_000);
    state.received = state.window === window ? state.received + 1 : 1;
    state.window = window;
    ws.serializeAttachment(state);
    if (state.received > 120 || typeof message !== 'string') {
      this.retire(ws, 1008);
      return;
    }
    if (encoder.encode(message).byteLength > 65_536) {
      this.retire(ws, 1009);
      return;
    }
    let input: unknown;
    try {
      input = JSON.parse(message);
    } catch {
      this.retire(ws, 1008);
      return;
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      this.retire(ws, 1008);
      return;
    }
    const envelope = input as Record<string, unknown>;
    const keys =
      state.role === 'host' ? ['v', 'type', 'clientId', 'payload'] : ['v', 'type', 'payload'];
    if (
      Object.keys(envelope).length !== keys.length ||
      keys.some((key) => !Object.hasOwn(envelope, key)) ||
      envelope.v !== 1 ||
      envelope.type !== (state.role === 'host' ? 'reply' : 'send') ||
      typeof envelope.payload !== 'string' ||
      encoder.encode(envelope.payload).byteLength > 60 * 1024 ||
      (state.role === 'host' &&
        (typeof envelope.clientId !== 'string' ||
          !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
            envelope.clientId,
          )))
    ) {
      this.retire(ws, 1008);
      return;
    }
    const destination = this.ctx.getWebSockets().find((peer) => {
      const target = this.connection(peer);
      return state.role === 'host'
        ? target.role === 'client' && target.id === envelope.clientId && target.hostId === state.id
        : target.role === 'host' && target.id === state.hostId;
    });
    if (!destination || !this.live(destination)) {
      this.retire(ws, 1008);
      return;
    }
    this.send(
      destination,
      state.role === 'host'
        ? { v: 1, type: 'reply', payload: envelope.payload }
        : { v: 1, type: 'message', clientId: state.id, payload: envelope.payload },
      ws,
    );
  }

  webSocketClose(ws: WebSocket): void {
    this.retire(ws, 1000);
  }
  webSocketError(ws: WebSocket): void {
    this.retire(ws, 1011);
  }
}

export default {
  fetch(request: Request, env: Env): Response | Promise<Response> {
    if (request.method === 'GET' && new URL(request.url).pathname === '/health') {
      return Response.json({ protocol: 'cairn-do-experiment', version: 1 });
    }
    const role = admission(request, env);
    if (role instanceof Response) return role;
    return env.RELAY.getByName('personal').fetch(request);
  },
};
