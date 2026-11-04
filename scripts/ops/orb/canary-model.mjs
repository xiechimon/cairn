import { createServer } from 'node:http';
import { resolve } from 'node:path';

export async function startModel(port, parentPid) {
  const requests = [];
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      res.writeHead(404).end();
      return;
    }
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 4 * 1024 * 1024) {
        res.writeHead(413).end();
        return;
      }
    }
    let request;
    try {
      request = JSON.parse(body);
    } catch {
      res.writeHead(400).end();
      return;
    }
    requests.push(request.model);
    const base = {
      id: 'chatcmpl-canary',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: 'canary-model',
    };
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const choices of [
      [
        {
          index: 0,
          delta: { role: 'assistant', content: 'The canary hook completed.' },
          finish_reason: null,
        },
      ],
      [{ index: 0, delta: {}, finish_reason: 'stop' }],
    ])
      res.write(`data: ${JSON.stringify({ ...base, choices })}\n\n`);
    res.end('data: [DONE]\n\n', () => {
      server.close();
      server.closeIdleConnections();
    });
  });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolveListen);
  });
  if (Number.isInteger(parentPid) && parentPid > 1) {
    const guard = setInterval(() => {
      try {
        process.kill(parentPid, 0);
      } catch {
        server.close();
        server.closeAllConnections();
      }
    }, 100);
    server.once('close', () => clearInterval(guard));
    guard.unref();
  }
  return { server, requests };
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const { server } = await startModel(Number(process.argv[2]), Number(process.argv[3]));
  process.send?.('ready');
  const timer = setTimeout(() => {
    server.close();
    server.closeAllConnections();
  }, 10 * 60_000);
  timer.unref();
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
}
