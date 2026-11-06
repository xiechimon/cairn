import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { chiefMessage, step } from '../../apps/server/src/db/schema.js';
import { api, bootRealServer, type RealServer } from './helpers.js';

let server: RealServer;

beforeEach(async () => {
  server = await bootRealServer({ providerBaseUrl: 'http://127.0.0.1:9' });
  const bound = await api(
    server.url,
    'PATCH',
    `/api/teams/${server.teamId}/routing-rules/coordinator`,
    {
      provider: 'stub-gw',
      modelId: 'stub-model',
    },
  );
  expect(bound.status).toBe(200);
});

afterEach(async () => {
  await server.close();
});

const send = (body: Record<string, unknown>) =>
  api(server.url, 'POST', `/api/teams/${server.teamId}/coordinator/messages`, body);

const userMessages = () =>
  server.db.select().from(chiefMessage).where(eq(chiefMessage.role, 'user')).all();

const chiefSteps = () => server.db.select().from(step).where(eq(step.kind, 'chief')).all();

test('the same client message id sent twice over HTTP is one message row and one step', async () => {
  const first = await send({ content: 'ship it', clientMessageId: 'attempt-1' });
  const second = await send({ content: 'ship it', clientMessageId: 'attempt-1' });
  expect(first.status).toBe(201);
  expect(second.status).toBe(201);
  expect((second.body as { message: { id: string } }).message.id).toBe(
    (first.body as { message: { id: string } }).message.id,
  );
  expect(userMessages()).toHaveLength(1);
  expect(chiefSteps()).toHaveLength(1);
});

test('a different client message id is a second message and a second step', async () => {
  await send({ content: 'ship it', clientMessageId: 'attempt-1' });
  await send({ content: 'ship it', clientMessageId: 'attempt-2' });
  expect(userMessages()).toHaveLength(2);
  expect(chiefSteps()).toHaveLength(2);
});
