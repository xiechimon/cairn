import {
  buildTaskPromptText,
  encodeReplyQuote,
  machineAttachmentResponseSchema,
  machineEnrollResponseSchema,
  TRANSCRIPT_PROMPT_ROW_ID_PREFIX,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { chiefMessage, chiefThread, coordinatorEntry, step, todo } from '../src/db/schema.js';
import { newRecordId } from '../src/lib/ids.js';
import { createRequestTodo } from '../src/services/coordinator-request.js';
import { updateTodo } from '../src/services/todos.js';
import { ctx, H, registerChiefHarness, toolDeps } from './chief-harness.js';
import { issueApiKey, req } from './helpers.js';
import { seedOwnerMessage } from './owner-message.js';

registerChiefHarness();

function sourceTurn(assistantText = 'The caret alignment issue is recorded.') {
  const ownerId = seedOwnerMessage(
    H.s.db,
    H.threadId,
    `The caret does not align with the entered digits.\n![caret.png](attachment:${H.teamId}/caret.png)`,
  );
  H.s.db
    .insert(step)
    .values({
      id: ownerId,
      buildId: H.threadId,
      kind: 'chief',
      status: 'done',
      ownerMessageIds: [ownerId],
      createdAt: 1,
    })
    .run();
  const assistantId = `${ownerId}-e10`;
  H.s.db
    .insert(chiefMessage)
    .values({
      id: assistantId,
      threadId: H.threadId,
      role: 'assistant',
      content: [{ type: 'text', text: assistantText }],
      createdAt: 2,
    })
    .run();
  const reply = encodeReplyQuote(
    { sourceMessageId: assistantId, quote: assistantText },
    'Please dispatch.',
  );
  return { ownerId, assistantId, reply };
}

function dispatch(content: string, quotes?: string[]) {
  const messageId = seedOwnerMessage(H.s.db, H.threadId, content);
  const created = createRequestTodo(
    toolDeps(),
    ctx(),
    {
      projectId: H.projectId,
      messageIds: [messageId],
      ...(quotes === undefined ? {} : { quotes }),
    },
    { createdBy: H.userId, ownerId: H.userId },
  );
  return H.s.db.select().from(todo).where(eq(todo.id, created.id)).get()!;
}

describe('quoted Coordinator context at dispatch', () => {
  test('inherits the original image and attributed messages without leaking reply wire', () => {
    const source = sourceTurn();
    seedOwnerMessage(
      H.s.db,
      H.threadId,
      `Unrelated request.\n![other.png](attachment:${H.teamId}/other.png)`,
    );
    const task = dispatch(source.reply);
    expect(task.userSpecAttachmentIds).toEqual(['caret']);
    expect(task.request?.segments[0]).toMatchObject({
      author: 'owner',
      text: source.reply,
      context: {
        incomplete: false,
        messages: [
          { threadId: H.threadId, messageId: source.ownerId, role: 'user' },
          { threadId: H.threadId, messageId: source.assistantId, role: 'assistant' },
        ],
      },
    });
    expect(task.title).toBe('The caret does not align with the entered digits.');
    const prompt = buildTaskPromptText(task.title, task.spec, task);
    expect(prompt).toContain(`\n![caret.png](attachment:${H.teamId}/caret.png)\n`);
    expect(prompt).toContain('Please dispatch.');
    expect(prompt).not.toContain('<!-- reply');
    expect(prompt).not.toContain('Unrelated request.');
  });

  test('does not authorize or deliver assistant-invented attachment tokens', () => {
    const source = sourceTurn(`Recorded.\n![invented.png](attachment:${H.teamId}/invented.png)`);
    const task = dispatch(source.reply);
    expect(task.userSpecAttachmentIds).toEqual(['caret']);
    expect(task.spec).not.toContain(`attachment:${H.teamId}/invented.png`);
  });

  test.each(['0.2.3', '0.2.4'])(
    'machine %s downloads inherited image bytes through the authenticated attachment route',
    async (cliVersion) => {
      const source = sourceTurn();
      const bytes = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGP48OHDfxBmgDEAiNQPPZGgNrYAAAAASUVORK5CYII=',
        'base64',
      );
      const grantResponse = await req(H.s.app, 'POST', '/api/uploads/grant', {
        kind: 'attachment',
        fileName: 'caret.png',
        mimeType: 'image/png',
        size: bytes.length,
        scope: 'spec',
      });
      expect(grantResponse.status).toBe(200);
      const grant = (await grantResponse.json()) as { grant: string; attachmentId: string };
      const form = new FormData();
      form.set('grant', grant.grant);
      form.set('file', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), 'caret.png');
      expect(
        (await H.s.app.request('/api/uploads/upload', { method: 'POST', body: form })).status,
      ).toBe(201);
      H.s.db
        .update(chiefMessage)
        .set({
          content: `The caret is misaligned.\n![caret.png](attachment:${H.teamId}/${grant.attachmentId}.png)`,
        })
        .where(eq(chiefMessage.id, source.ownerId))
        .run();
      const task = dispatch(source.reply);
      const apiKey = await issueApiKey(H.s);
      const enrolled = await H.s.app.request('/api/machine/enroll', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ teamId: H.teamId, name: 'reply-context-machine', cliVersion }),
      });
      expect(enrolled.status).toBe(200);
      const machine = machineEnrollResponseSchema.parse(await enrolled.json());
      const built = await req(H.s.app, 'POST', `/api/projects/${H.projectId}/builds`, {
        todoIds: [task.id],
        withPlan: false,
        routeOverride: { machineId: machine.machineId },
      });
      expect(built.status).toBe(201);
      const claimed = await H.s.app.request('/api/machine/tasks/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${machine.token}` },
        body: '{}',
      });
      expect(claimed.status).toBe(200);
      const claim = (await claimed.json()) as {
        step: { step: { id: string }; todo: { request?: unknown; spec: string } } | null;
      };
      expect(claim.step).not.toBeNull();
      expect(claim.step?.todo.request).toEqual(cliVersion === '0.2.4' ? task.request : undefined);
      expect(claim.step?.todo.spec).toContain(`attachment:${H.teamId}/${grant.attachmentId}.png`);
      expect(claim.step?.todo.spec).not.toContain('reply source=');
      const image = await H.s.app.request(
        `/api/machine/attachment/${claim.step!.step.id}/${grant.attachmentId}?teamId=${H.teamId}`,
        { headers: { authorization: `Bearer ${machine.token}` } },
      );
      expect(image.status).toBe(200);
      expect(
        Buffer.from(
          machineAttachmentResponseSchema.parse(await image.json()).contentBase64,
          'base64',
        ),
      ).toEqual(bytes);
    },
  );

  test('does not inherit later steers from the producing step', () => {
    const source = sourceTurn();
    const laterId = seedOwnerMessage(
      H.s.db,
      H.threadId,
      `Later request.\n![later.png](attachment:${H.teamId}/later.png)`,
    );
    H.s.db
      .update(step)
      .set({ ownerMessageIds: [source.ownerId, laterId] })
      .where(eq(step.id, source.ownerId))
      .run();
    H.s.db
      .insert(coordinatorEntry)
      .values([
        {
          chiefMessageId: source.ownerId,
          threadId: H.threadId,
          conversationId: 'conversation',
          entryId: '1',
        },
        {
          chiefMessageId: source.assistantId,
          threadId: H.threadId,
          conversationId: 'conversation',
          entryId: '10',
        },
        {
          chiefMessageId: laterId,
          threadId: H.threadId,
          conversationId: 'conversation',
          entryId: '11',
        },
      ])
      .run();
    const task = dispatch(source.reply);
    expect(task.userSpecAttachmentIds).toEqual(['caret']);
    expect(task.spec).not.toContain('Later request.');
  });

  test('a partial quote that discards the reply binding does not inherit images', () => {
    const source = sourceTurn();
    const task = dispatch(`${source.reply}\n\nIndependently update the README.`, [
      'Independently update the README.',
    ]);
    expect(task.userSpecAttachmentIds).toEqual([]);
    expect(task.request?.segments[0]).not.toHaveProperty('context');
    expect(task.spec).toBe('> Independently update the README.');
  });

  test('whole-task copies retain the persisted snapshot after source text changes', () => {
    const source = sourceTurn();
    const task = dispatch(source.reply);
    H.s.db
      .update(chiefMessage)
      .set({ content: 'Changed after dispatch.' })
      .where(eq(chiefMessage.id, source.ownerId))
      .run();
    const copied = createRequestTodo(
      toolDeps(),
      ctx(),
      { projectId: H.projectId, sourceTodoId: task.id },
      { createdBy: H.userId, ownerId: H.userId },
    );
    const stored = H.s.db.select().from(todo).where(eq(todo.id, copied.id)).get()!;
    expect(stored.request?.segments).toEqual(task.request?.segments);
    expect(stored.userSpecAttachmentIds).toEqual(['caret']);
    expect(buildTaskPromptText(stored.title, stored.spec, stored)).toContain(
      'The caret does not align',
    );
    expect(stored.spec).not.toContain('Changed after dispatch.');
  });

  test('an explicit owner specification replacement removes inherited context and grants', () => {
    const source = sourceTurn();
    const task = dispatch(source.reply);
    updateTodo(toolDeps(), task.id, { spec: 'Independently update the README.' });
    const stored = H.s.db.select().from(todo).where(eq(todo.id, task.id)).get()!;
    expect(stored.spec).toBe('Independently update the README.');
    expect(stored.userSpecAttachmentIds).toEqual([]);
    expect(stored.request?.segments[0]).not.toHaveProperty('context');
  });

  test('missing, synthetic, and foreign references retain the quote with incomplete provenance', () => {
    const foreignThreadId = newRecordId();
    H.s.db
      .insert(chiefThread)
      .values({
        id: foreignThreadId,
        chiefId: H.chiefId,
        userId: H.userId,
        teamId: H.teamId,
        title: 'Other thread',
        createdAt: 1,
        updatedAt: 1,
        sessionId: '',
        sessionOpenedAt: 1,
        archivedAt: 2,
      })
      .run();
    const syntheticId = `${TRANSCRIPT_PROMPT_ROW_ID_PREFIX}synthetic`;
    H.s.db
      .insert(chiefMessage)
      .values([
        {
          id: syntheticId,
          threadId: H.threadId,
          role: 'user',
          content: `Synthetic input.\n![secret.png](attachment:${H.teamId}/secret.png)`,
          createdAt: 1,
        },
        {
          id: 'foreign-source',
          threadId: foreignThreadId,
          role: 'user',
          content: `Private input.\n![foreign.png](attachment:${H.teamId}/foreign.png)`,
          createdAt: 1,
        },
      ])
      .run();
    for (const sourceMessageId of ['missing-source', syntheticId, 'foreign-source']) {
      const task = dispatch(
        encodeReplyQuote({ sourceMessageId, quote: 'Quoted context.' }, 'Please dispatch.'),
      );
      expect(task.request?.segments[0]).toMatchObject({
        context: { incomplete: true, messages: [] },
      });
      expect(task.userSpecAttachmentIds).toEqual([]);
      expect(task.spec).toContain('Quoted context.');
      expect(task.spec).not.toContain('<!-- reply');
    }
  });

  test('a self-referential reply is incomplete and finite', () => {
    const id = newRecordId();
    const reply = encodeReplyQuote(
      { sourceMessageId: id, quote: 'Quoted context.' },
      'Please dispatch.',
    );
    H.s.db
      .insert(chiefMessage)
      .values({ id, threadId: H.threadId, role: 'user', content: reply, createdAt: 1 })
      .run();
    const task = createRequestTodo(
      toolDeps(),
      ctx(),
      { projectId: H.projectId, messageIds: [id] },
      { createdBy: H.userId, ownerId: H.userId },
    );
    expect(task.request?.segments[0]).toMatchObject({
      context: { incomplete: true, messages: [] },
    });
  });
});
