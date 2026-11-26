import assert from 'node:assert/strict';
import { createServer } from 'node:http';

export async function startStubProvider(chunksFor) {
  let calls = 0;
  const server = createServer((request, response) => {
    let raw = '';
    request.setEncoding('utf8');
    request.on('data', (part) => {
      raw += part;
    });
    request.on('end', () => {
      if (!request.url?.endsWith('/chat/completions')) return response.writeHead(404).end();
      calls += 1;
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(
        chunksFor(JSON.parse(raw))
          .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
          .join(''),
      );
    });
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return {
    url: `http://127.0.0.1:${server.address().port}/v1`,
    calls: () => calls,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}

export async function useAsCoordinatorModel(window, baseUrl) {
  const failed = await window.evaluate(async (url) => {
    const [team] = await (await fetch('/api/teams')).json();
    const send = async (method, path, body) => {
      const response = await fetch(`/api/teams/${team.id}${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return response.ok ? null : `${method} ${path} ${response.status}: ${await response.text()}`;
    };
    return (
      (await send('POST', '/providers', {
        providerId: 'journey-gateway',
        label: 'Journey Gateway',
        baseUrl: url,
        api: 'openai-completions',
        authHeader: true,
        apiKey: 'journey-key',
        compat: { supportsDeveloperRole: false },
        models: [{ id: 'journey-model', name: 'journey-model' }],
      })) ??
      (await send('PATCH', '/routing-rules/coordinator', {
        provider: 'journey-gateway',
        modelId: 'journey-model',
      }))
    );
  }, baseUrl);
  assert.equal(failed, null, `seed Coordinator model: ${failed}`);
}
