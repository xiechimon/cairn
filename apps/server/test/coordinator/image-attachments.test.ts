import { zstdDecompressSync } from 'node:zlib';
import {
  type Context,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createCoordinatorModels } from '../../src/coordinator/runtime/models.js';
import { chiefMessage, step } from '../../src/db/schema.js';
import { req } from '../helpers.js';
import { boot, world } from './runner-world.js';

const imageData =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('Coordinator owner image attachments', () => {
  it.each([
    'openai-codex-responses',
    'openai-responses',
    'anthropic-messages',
    'openai-completions',
  ] as const)(
    'delivers an owner upload through the Coordinator into the actual %s request',
    async (api) => {
      const w = await world('hello');
      const bytes = Buffer.from(imageData, 'base64');
      const granted = await req(w.s.app, 'POST', '/api/uploads/grant', {
        kind: 'attachment',
        fileName: 'shot.png',
        mimeType: 'image/png',
        size: bytes.length,
      });
      expect(granted.status).toBe(200);
      const grant = (await granted.json()) as { grant: string; key: string };
      const form = new FormData();
      form.set('grant', grant.grant);
      form.set('file', new Blob([bytes], { type: 'image/png' }), 'shot.png');
      expect(
        (await w.s.app.request('/api/uploads/upload', { method: 'POST', body: form })).status,
      ).toBe(201);
      const faux = fauxProvider({
        provider: 'stub',
        models: [{ id: 'm', contextWindow: 200_000 }],
      });
      const results: unknown[] = [];
      let modelContext: Context | undefined;
      faux.setResponses([
        fauxAssistantMessage('Ready'),
        fauxAssistantMessage([fauxToolCall('attachment', { attachmentId: grant.key })], {
          stopReason: 'toolUse',
        }),
        (context: Context) => {
          modelContext = context;
          results.push(context.messages.at(-1)?.content);
          return fauxAssistantMessage('Image received');
        },
      ]);
      const coordinator = boot(w, faux);
      coordinator.wake(w.threadId);
      await coordinator.idle();
      const sent = await req(w.s.app, 'POST', `/api/conversations/${w.threadId}/messages`, {
        content: `![shot.png](attachment:${grant.key})\nDescribe this image`,
      });
      expect(sent.status).toBe(201);
      coordinator.wake(w.threadId);
      await coordinator.idle();
      expect(
        w.s.db
          .select()
          .from(step)
          .all()
          .map((row) => row.kind),
      ).toEqual(['chief', 'chief']);
      expect(results).toEqual([[{ type: 'image', data: imageData, mimeType: 'image/png' }]]);
      expect(modelContext).toBeDefined();
      const models = createCoordinatorModels();
      const providerId = api === 'openai-codex-responses' ? 'openai-codex' : 'wire-test';
      models.useStepProvider({
        kind: 'http',
        providerId,
        ...(api === 'openai-codex-responses' ? {} : { baseUrl: 'http://127.0.0.1:9' }),
        api: api === 'openai-codex-responses' ? 'openai-responses' : api,
        models: [{ id: 'm', name: 'm' }],
      });
      const jwtPayload = Buffer.from(
        JSON.stringify({
          'https://api.openai.com/auth': { chatgpt_account_id: 'test' },
        }),
      ).toString('base64url');
      await models.setApiKey(providerId, `test.${jwtPayload}.test`);
      const model = models.models.getModel(providerId, 'm')!;
      let payload: unknown;
      await models.models.complete(model, modelContext!, {
        maxRetries: 0,
        transport: 'sse',
        fetch: async (url, init) => {
          const request = new Request(url, init);
          const bytes = Buffer.from(await request.arrayBuffer());
          payload = JSON.parse(
            (request.headers.get('content-encoding') === 'zstd'
              ? zstdDecompressSync(bytes)
              : bytes
            ).toString('utf8'),
          );
          return new Response(
            JSON.stringify({ error: { message: 'Captured by test transport' } }),
            {
              status: 400,
              headers: { 'content-type': 'application/json' },
            },
          );
        },
      });
      expect(payload).toBeDefined();
      if (api === 'openai-responses' || api === 'openai-codex-responses') {
        expect(payload).toMatchObject({
          input: expect.arrayContaining([
            {
              type: 'function_call_output',
              call_id: expect.any(String),
              output: [
                {
                  type: 'input_image',
                  detail: 'auto',
                  image_url: `data:image/png;base64,${imageData}`,
                },
              ],
            },
          ]),
        });
      } else if (api === 'anthropic-messages') {
        expect(JSON.stringify(payload)).toContain(
          JSON.stringify({
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: imageData },
          }),
        );
      } else {
        expect(payload).toMatchObject({
          messages: expect.arrayContaining([
            {
              role: 'user',
              content: expect.arrayContaining([
                {
                  type: 'image_url',
                  image_url: { url: `data:image/png;base64,${imageData}` },
                },
              ]),
            },
          ]),
        });
      }
      const messages = w.s.db
        .select()
        .from(chiefMessage)
        .where(eq(chiefMessage.threadId, w.threadId))
        .all();
      expect(JSON.stringify(messages.map((row) => row.content))).toContain('Image received');
    },
  );
});
