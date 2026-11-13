import {
  encodeReplyQuote,
  machineAttachmentResponseSchema,
  machineEnrollResponseSchema,
} from '@cairn/shared';
import {
  fauxAssistantMessage,
  fauxToolCall,
  type Context as ModelContext,
} from '@earendil-works/pi-ai';
import { eq } from 'drizzle-orm';
import { expect, test, vi } from 'vitest';
import { chiefMessage, coordinatorInput, coordinatorRun, step, todo } from '../../src/db/schema.js';
import { createRequestTodo } from '../../src/services/coordinator-request.js';
import { issueApiKey, postProject, req, seedSessionRoute } from '../helpers.js';
import { seedOwnerMessage } from '../owner-message.js';
import { boot, stub, world } from './runner-world.js';

test('a quoted answer inherits an image consumed as a steer in the real Coordinator runtime', async () => {
  const w = await world('Wait for an image before dispatching.');
  const projectId = await postProject(w.s.app, 'steer-image-proof');
  const imageData =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const bytes = Buffer.from(imageData, 'base64');
  const grantResponse = await req(w.s.app, 'POST', '/api/uploads/grant', {
    kind: 'attachment',
    fileName: 'steer.png',
    mimeType: 'image/png',
    size: bytes.length,
    scope: 'message',
  });
  expect(grantResponse.status).toBe(200);
  const grant = (await grantResponse.json()) as {
    grant: string;
    key: string;
    attachmentId: string;
  };
  const form = new FormData();
  form.set('grant', grant.grant);
  form.set('file', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), 'steer.png');
  expect(
    (await w.s.app.request('/api/uploads/upload', { method: 'POST', body: form })).status,
  ).toBe(201);
  let imageContent: unknown;
  let firstRequestBound = false;
  const { faux } = stub('Complete.');
  faux.setResponses([
    () => {
      firstRequestBound = w.s.db.select().from(coordinatorRun).get()?.stepId === w.stepId;
      return fauxAssistantMessage(
        [
          fauxToolCall('ask_user', {
            questions: [{ header: 'Continue', question: 'Ready?', options: [{ label: 'Yes' }] }],
          }),
        ],
        { stopReason: 'toolUse' },
      );
    },
    fauxAssistantMessage([fauxToolCall('attachment', { attachmentId: grant.key })], {
      stopReason: 'toolUse',
    }),
    (context: ModelContext) => {
      imageContent = context.messages.at(-1)?.content;
      return fauxAssistantMessage('The image is received.');
    },
    fauxAssistantMessage('Complete.'),
  ]);
  const coordinator = boot(w, faux);
  coordinator.wake(w.threadId);
  const question = () =>
    w.s.db
      .select()
      .from(chiefMessage)
      .all()
      .find((row) => JSON.stringify(row.content).includes('ask_user_question'));
  await vi.waitFor(() => expect(question()).toBeDefined(), { timeout: 8_000 });
  const sent = await req(w.s.app, 'POST', `/api/conversations/${w.threadId}/messages`, {
    content: `Inspect this screenshot.\n![steer.png](attachment:${grant.key})`,
  });
  expect(sent.status).toBe(201);
  const sentBody = (await sent.json()) as { message: { id: string } };
  const ownerId = sentBody.message.id;
  const steered = await req(
    w.s.app,
    'POST',
    `/api/teams/${w.teamId}/chief/threads/${w.threadId}/messages/${ownerId}/steer`,
  );
  expect(steered.status).toBe(200);
  await vi.waitFor(
    () =>
      expect(
        w.s.db.select().from(coordinatorInput).where(eq(coordinatorInput.id, ownerId)).get()
          ?.conversationId,
      ).toEqual(expect.any(String)),
    { timeout: 8_000 },
  );
  const answered = await req(
    w.s.app,
    'POST',
    `/api/teams/${w.teamId}/chief/threads/${w.threadId}/questions/${question()!.id}/answer`,
    {
      answers: [{ header: 'Continue', choices: ['Yes'] }],
    },
  );
  expect(answered.status).toBe(200);
  await vi.waitFor(
    () =>
      expect(w.s.db.select().from(step).where(eq(step.id, w.stepId)).get()?.status).toBe('done'),
    { timeout: 8_000 },
  );
  const source = w.s.db
    .select()
    .from(chiefMessage)
    .all()
    .find(
      (row) =>
        row.role === 'assistant' && JSON.stringify(row.content).includes('The image is received.'),
    );
  expect(source).toBeDefined();
  const dispatchId = seedOwnerMessage(
    w.s.db,
    w.threadId,
    encodeReplyQuote(
      {
        sourceMessageId: source!.id,
        quote: 'The image is received.',
      },
      'Please dispatch.',
    ),
  );
  const task = createRequestTodo(
    { db: w.s.db, hub: w.s.hub, user: w.s.user },
    {
      teamId: w.teamId,
      threadId: w.threadId,
    },
    { projectId, messageIds: [dispatchId] },
    { createdBy: w.s.user.id, ownerId: w.s.user.id },
  );
  const stored = w.s.db.select().from(todo).where(eq(todo.id, task.id)).get();
  expect(stored?.userSpecAttachmentIds).toEqual([grant.attachmentId]);
  expect(firstRequestBound).toBe(true);
  expect(imageContent).toEqual([{ type: 'image', data: imageData, mimeType: 'image/png' }]);
  expect(
    task.request?.segments[0]?.context?.messages.map((message) => message.messageId),
  ).toContain(ownerId);
  seedSessionRoute(w.s, { provider: 'stub', modelId: 'm' });
  const apiKey = await issueApiKey(w.s);
  const enrolled = await w.s.app.request('/api/machine/enroll', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ teamId: w.teamId, name: 'steer-proof', cliVersion: '0.2.4' }),
  });
  expect(enrolled.status).toBe(200);
  const machine = machineEnrollResponseSchema.parse(await enrolled.json());
  seedSessionRoute(w.s, { provider: 'stub', modelId: 'm', machineId: machine.machineId });
  expect(
    (
      await req(w.s.app, 'POST', `/api/projects/${projectId}/builds`, {
        todoIds: [task.id],
        withPlan: false,
      })
    ).status,
  ).toBe(201);
  const claimed = await w.s.app.request('/api/machine/tasks/claim', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${machine.token}` },
    body: '{}',
  });
  expect(claimed.status).toBe(200);
  const claim = (await claimed.json()) as {
    step: { step: { id: string }; todo: { request: unknown; spec: string } } | null;
  };
  expect(claim.step?.todo.request).toEqual(stored?.request);
  expect(claim.step?.todo.spec).not.toContain('reply source=');
  const downloaded = await w.s.app.request(
    `/api/machine/attachment/${claim.step!.step.id}/${grant.attachmentId}?teamId=${w.teamId}`,
    { headers: { authorization: `Bearer ${machine.token}` } },
  );
  expect(downloaded.status).toBe(200);
  expect(
    Buffer.from(
      machineAttachmentResponseSchema.parse(await downloaded.json()).contentBase64,
      'base64',
    ),
  ).toEqual(bytes);
}, 25_000);
