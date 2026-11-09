import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { chiefMessage, step } from '../../src/db/schema.js';
import { req } from '../helpers.js';
import { boot, world } from './runner-world.js';

const imageData =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('Coordinator owner image attachments', () => {
  it('reads an owner upload by its token key through the chief relay and delivers an image block', async () => {
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
    const faux = fauxProvider({ provider: 'stub', models: [{ id: 'm', contextWindow: 200_000 }] });
    const results: unknown[] = [];
    faux.setResponses([
      fauxAssistantMessage('Ready'),
      fauxAssistantMessage([fauxToolCall('attachment', { attachmentId: grant.key })], {
        stopReason: 'toolUse',
      }),
      (context: { messages: { role: string; content: unknown }[] }) => {
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
    const messages = w.s.db
      .select()
      .from(chiefMessage)
      .where(eq(chiefMessage.threadId, w.threadId))
      .all();
    expect(JSON.stringify(messages.map((row) => row.content))).toContain('Image received');
  });
});
