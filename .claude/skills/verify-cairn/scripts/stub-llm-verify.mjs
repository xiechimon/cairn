import { createServer } from 'node:http';

const PORT = Number(process.env.STUB_PORT ?? 8919);
const DELAY_MS = Number(process.env.STUB_DELAY_MS ?? 30_000);
const server = createServer((req, res) => {
  if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
    res.writeHead(404).end();
    return;
  }
  let body = '';
  req.on('data', (d) => {
    body += d;
  });
  req.on('end', () => {
    let responded = false;
    const timer = setTimeout(() => {
      responded = true;
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
      });
      const base = {
        id: 'chatcmpl-stub',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'stub-model',
      };
      res.write(
        `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: 'assistant' } }] })}\n\n`,
      );
      res.write(
        `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { content: '这轮永远不会说完…' } }] })}\n\n`,
      );
      res.write(
        `data: ${JSON.stringify({
          ...base,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
        })}\n\n`,
      );
      res.write('data: [DONE]\n\n');
      res.end();
    }, DELAY_MS);

    res.on('close', () => {
      if (!responded) clearTimeout(timer);
    });
  });
});
server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`stub-llm listening on ${PORT} (delay ${DELAY_MS}ms)\n`);
});
