import { createServer } from 'node:http';
import { join } from 'node:path';
import type { StepEvent } from '@cairn/shared';
import { expect, test } from 'vitest';
import { createPiBackend } from '../src/backend/pi.js';
import { testTempDir } from './test-temp-dir.js';

test.each(['', ' (upstream status 503)'])(
  'real SDK does not retry a model rejection%s',
  async (suffix) => {
    let requests = 0;
    const server = createServer((_req, res) => {
      requests++;
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            message: `Model "glm-5.3" is not supported by any configured account in this group${suffix}`,
            type: 'model_not_found',
          },
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test listener');
    const directory = testTempDir('pi-model-rejection-');
    const backend = createPiBackend({
      agentDir: join(directory, 'agent'),
      sessionDir: join(directory, 'sessions'),
    });
    const handle = await backend.createSession({
      cwd: directory,
      provider: {
        kind: 'http',
        providerId: 'synthetic-model-relay',
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        api: 'openai-completions',
        models: [{ id: 'glm-5.3', name: 'Synthetic rejected model' }],
      },
      modelId: 'glm-5.3',
      prompt: 'Say hello',
    });
    const events: StepEvent[] = [];
    try {
      for await (const event of handle.events) {
        events.push(event);
        if (event.type === 'auto_retry_start') await handle.stop();
      }
      expect(events.filter((event) => event.type === 'auto_retry_start')).toHaveLength(0);
      expect(requests).toBe(1);
      expect(
        events.some((event) => event.type === 'error' && event.error.message.includes('glm-5.3')),
      ).toBe(true);
    } finally {
      await handle.stop();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
);
