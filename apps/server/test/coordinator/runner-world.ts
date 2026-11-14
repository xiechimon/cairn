import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxProvider,
} from '@earendil-works/pi-ai';
import { afterEach, beforeEach, expect } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../../scripts/test-tmpdir.mjs';
import { type Coordinator, startCoordinator } from '../../src/coordinator/index.js';
import { SUGGEST_REPLIES_ASK } from '../../src/coordinator/runtime/suggest-replies.js';
import { routingRule, step } from '../../src/db/schema.js';
import {
  setCoordinatorInServer,
  setCoordinatorServerContextEnabled,
  setCoordinatorWake,
} from '../../src/services/coordinator-context.js';
import { createProvider } from '../../src/services/providers.js';
import { bootServer, insertMachine, req, type TestServer } from '../helpers.js';

export const KEY = 'sk-stub-secret-key-0123456789';
const dirs: string[] = [];
const closers: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  for (const d of dirs.splice(0)) releaseTestTempDir(d);
  setCoordinatorInServer(false);
  setCoordinatorServerContextEnabled(false);
  setCoordinatorWake(() => {});
});

beforeEach(() => {
  setCoordinatorInServer(true);
  setCoordinatorServerContextEnabled(true);
});

export interface World {
  s: TestServer;
  teamId: string;
  threadId: string;
  stepId: string;
  storageDir: string;
}

export async function world(content = 'hello', apiKey = KEY): Promise<World> {
  const s = bootServer();
  insertMachine(s);
  closers.push(() => s.dispose());
  const teamId = s.team.id;
  createProvider(
    { db: s.db, box: s.secretBox },
    {
      teamId,
      body: {
        providerId: 'stub',
        label: 'Stub',
        baseUrl: 'http://127.0.0.1:9',
        api: 'openai-completions',
        apiKey,
        models: [{ id: 'm', name: 'm' }],
      },
      createdBy: s.user.id,
    },
  );
  s.db
    .insert(routingRule)
    .values({
      id: 'rule-coordinator',
      teamId,
      use: 'coordinator',
      provider: 'stub',
      modelId: 'm',
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
  const sent = await req(s.app, 'POST', `/api/teams/${teamId}/chief/threads`, { content });
  expect(sent.status).toBe(201);
  const { thread } = (await sent.json()) as { thread: { id: string } };
  const stepRow = s.db.select().from(step).get();
  const storageDir = makeTestTempDir('coord-runner-');
  dirs.push(storageDir);
  return { s, teamId, threadId: thread.id, stepId: stepRow?.id ?? '', storageDir };
}

export function boot(
  w: World,
  faux: ReturnType<typeof fauxProvider>,
  extra: object = {},
): Coordinator {
  const coordinator = startCoordinator({
    machine: {
      db: w.s.db,
      hub: w.s.hub,
      machineHub: w.s.machineHub,
      box: w.s.secretBox,
      user: w.s.user,
      vapidKeys: w.s.vapidKeys,
      reposDir: w.s.reposDir,
      attachmentsDir: w.s.attachmentsDir,
      skillsDir: w.s.skillsDir,
      convHub: w.s.convHub,
    },
    storageDir: w.storageDir,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    heartbeatMs: 1_000,
    tickMs: 3_600_000,
    stopPollMs: 50,
    fixedProviders: [
      {
        ...faux.provider,
        streamSimple(model, context, options) {
          if (context.messages[0]?.content !== SUGGEST_REPLIES_ASK)
            return faux.provider.streamSimple(model, context, options);
          const stream = createAssistantMessageEventStream();
          const message = {
            ...fauxAssistantMessage('{"replies":[]}'),
            api: model.api,
            provider: model.provider,
            model: model.id,
          };
          stream.push({ type: 'done', reason: 'stop', message });
          stream.end(message);
          return stream;
        },
      },
    ],
    ...extra,
  });
  closers.push(() => coordinator.close());
  return coordinator;
}

export function stub(answer: string) {
  const faux = fauxProvider({
    provider: 'stub',
    models: [{ id: 'm', contextWindow: 200_000 }],
    tokensPerSecond: 1e9,
  });
  const seen: { system: string; messages: unknown[] }[] = [];
  faux.setResponses(
    Array(16).fill((c: { systemPrompt?: string; messages: { content: unknown }[] }) => {
      seen.push({ system: c.systemPrompt ?? '', messages: c.messages });
      return fauxAssistantMessage(answer);
    }),
  );
  return { faux, seen };
}
