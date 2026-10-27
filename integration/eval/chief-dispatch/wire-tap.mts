#!/usr/bin/env -S pnpm exec tsx
import { appendFileSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest, type IncomingMessage } from 'node:http';

const PORT = Number(process.argv[2] ?? 8901);
const UPSTREAM = process.argv[3] ?? process.env.CAIRN_EVAL_RELAY_UPSTREAM;
if (!UPSTREAM)
  throw new Error(
    'upstream missing: pass it as the second argument or set CAIRN_EVAL_RELAY_UPSTREAM',
  );
const OUT = process.argv[4] ?? '/tmp/wire-tap.jsonl';

writeFileSync(OUT, '');
console.log(`wire-tap 监听 :${PORT} → ${UPSTREAM}\n记录到 ${OUT}`);

createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    if (req.url?.includes('/chat/completions')) {
      try {
        const j = JSON.parse(body.toString('utf8')) as Record<string, unknown>;
        const thinking = {
          reasoning_effort: j.reasoning_effort,
          thinking: j.thinking,
          enable_thinking: j.enable_thinking,
          reasoning: j.reasoning,
        };
        const roles = (j.messages as { role?: string }[] | undefined)?.map((m) => m.role);
        appendFileSync(
          OUT,
          `${JSON.stringify({
            model: j.model,
            thinking,
            systemRole: roles?.[0],
            tools: (j.tools as unknown[] | undefined)?.length,
            maxTokens: j.max_tokens ?? j.max_completion_tokens,
          })}\n`,
        );
      } catch (e) {
        appendFileSync(OUT, `${JSON.stringify({ parseError: String(e) })}\n`);
      }
    }
    const up = new URL(req.url ?? '/', UPSTREAM);
    const proxyReq = httpRequest(
      {
        hostname: up.hostname,
        port: up.port || 80,
        path: up.pathname + up.search,
        method: req.method,
        headers: { ...req.headers, host: up.host },
      },
      (proxyRes: IncomingMessage) => {
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
        proxyRes.pipe(res);
      },
    );
    proxyReq.on('error', () => res.writeHead(502).end());
    proxyReq.end(body);
  });
}).listen(PORT);
