import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import WebSocket from 'ws';

export async function startRuntime({ instrument = false, bindings = {} } = {}) {
  const hostCapability = randomBytes(32).toString('hex');
  const clientCapability = randomBytes(32).toString('hex');
  const source = await readFile(new URL('./worker.ts', import.meta.url), 'utf8');
  let script = stripTypeScriptTypes(source, { mode: 'transform', sourceMap: false });
  if (instrument) {
    script = script.replace('export default {', 'const application = {');
    script += `
      export class InstrumentedRelay extends PersonalRelay {
        constructor(ctx, env) {
          super(ctx, env);
          this.testContext = ctx;
          ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS test_clock (id INTEGER PRIMARY KEY, now INTEGER)');
          const rows = ctx.storage.sql.exec('SELECT now FROM test_clock WHERE id = 1').toArray();
          if (rows.length) Date.now = () => rows[0].now;
        }
        fetch(request) {
          const url = new URL(request.url);
          if (url.pathname === '/__test/clock') {
            const now = Number(url.searchParams.get('now'));
            this.testContext.storage.sql.exec('INSERT OR REPLACE INTO test_clock VALUES (1, ?)', now);
            Date.now = () => now;
            return new Response(null, { status: 204 });
          }
          if (url.pathname === '/__test/send-failure') {
            WebSocket.prototype.send = () => { throw new Error('Injected transport failure'); };
            return new Response(null, { status: 204 });
          }
          if (url.pathname === '/__test/late-close') {
            if (this.closedHost) super.webSocketClose(this.closedHost);
            return new Response(null, { status: 204 });
          }
          return super.fetch(request);
        }
        webSocketClose(ws) {
          if (ws.deserializeAttachment().role === 'host') this.closedHost = ws;
          super.webSocketClose(ws);
        }
      }
      export default {
        fetch(request, env) {
          if (new URL(request.url).pathname.startsWith('/__test/')) {
            return env.RELAY.getByName('personal').fetch(request);
          }
          return application.fetch(request, env);
        }
      };
    `;
  }
  const className = instrument ? 'InstrumentedRelay' : 'PersonalRelay';
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      name: 'relay',
      host: '127.0.0.1',
      port: 0,
      modules: true,
      compatibilityDate: '2026-11-15',
      script,
      durableObjects: { RELAY: { className, useSQLite: true } },
      bindings: {
        HOST_CAPABILITY: hostCapability,
        CLIENT_CAPABILITY: clientCapability,
        ...bindings,
      },
    }),
  );
  const sockets = new Set();
  const base = await runtime.ready;
  return {
    runtime,
    base,
    className,
    async request(path, options = {}) {
      return runtime.dispatchFetch(new URL(path, base), options);
    },
    async connect(
      role,
      { capability, authenticateAs = role, path = `/connect/${role}`, headers = {} } = {},
    ) {
      const url = new URL(path, base);
      url.protocol = 'ws:';
      const ws = new WebSocket(url, {
        headers: {
          Authorization: `Bearer ${capability ?? (authenticateAs === 'host' ? hostCapability : clientCapability)}`,
          ...headers,
        },
      });
      sockets.add(ws);
      const messages = [];
      const waiting = [];
      let closeResult;
      let resolveClose;
      const closed = new Promise((resolve) => {
        resolveClose = resolve;
      });
      ws.on('message', (data) => {
        const value = JSON.parse(data.toString());
        const resolve = waiting.shift();
        if (resolve) resolve(value);
        else messages.push(value);
      });
      ws.on('close', (code) => {
        closeResult = code;
        resolveClose(code);
      });
      const status = await new Promise((resolve, reject) => {
        ws.once('open', () => resolve(101));
        ws.once('unexpected-response', (_request, response) => {
          response.resume();
          ws.terminate();
          resolve(response.statusCode);
        });
        ws.on('error', (error) => {
          if (!error.message.includes('before the connection was established')) reject(error);
        });
      });
      const endpoint = {
        ws,
        status,
        closed,
        messages,
        get closeCode() {
          return closeResult;
        },
        send(value) {
          ws.send(typeof value === 'string' ? value : JSON.stringify(value));
        },
        next() {
          return messages.length
            ? Promise.resolve(messages.shift())
            : new Promise((resolve) => waiting.push(resolve));
        },
      };
      if (status === 101) endpoint.welcome = await endpoint.next();
      return endpoint;
    },
    async evict() {
      const namespace = await runtime.getDurableObjectNamespace('RELAY');
      await namespace.getByName('personal').fetch('http://localhost/__wake');
      return runtime.unsafeEvictDurableObject('relay', className, {
        name: 'personal',
        webSockets: 'hibernate',
      });
    },
    async dispose() {
      for (const ws of sockets) ws.terminate();
      await runtime.dispose();
    },
  };
}
