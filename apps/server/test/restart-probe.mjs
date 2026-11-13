import { join } from 'node:path';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import { createServerRuntime } from '../src/coordinator/runtime/server-runtime.ts';

const PROVIDER = {
  kind: 'http',
  providerId: 'team-stub',
  label: 'Stub',
  baseUrl: 'http://127.0.0.1:9',
  api: 'openai-completions',
  models: [{ id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', contextWindow: 200_000 }],
};
const THREAD = 'thread-restart';
const MODEL = { provider: PROVIDER.providerId, modelId: PROVIDER.models[0].id };

const dir = process.argv[2];
const mode = process.argv[3];
const ctx = BACKGROUND_CONTEXT;

function heldProvider() {
  const faux = fauxProvider({
    provider: PROVIDER.providerId,
    models: [{ id: PROVIDER.models[0].id, contextWindow: 200_000 }],
  });
  faux.setResponses([
    async () => {
      await new Promise(() => {});
      return fauxAssistantMessage([fauxToolCall('request_takeover', { reason: 'login' })], {
        stopReason: 'toolUse',
      });
    },
  ]);
  return faux.provider;
}

function runtime(fixed) {
  return createServerRuntime(
    {
      storageDir: dir,
      heartbeatMs: 60_000,
      routerTools: false,
      ...(fixed === undefined ? {} : { fixedProviders: [fixed] }),
      factsFor: () => ({
        conversationId: null,
        lastMirroredEntryId: null,
        piVersion: '1.5.0',
        hasClaimedStep: true,
        isLive: () => true,
        seed: async () => ({ summary: '', rows: [], model: MODEL }),
        record: () => {},
      }),
      providersFor: () => [
        { config: PROVIDER, modelId: MODEL.modelId, resolveKey: () => 'step-key' },
      ],
    },
    {
      claim: async () => null,
      recover: async () => [],
      token: async () => ({ provider: null, secrets: {}, git: null }),
      heartbeat: async () => {},
      stop: async () => null,
      relayTool: async () => '',
      askUser: async () => ({ status: 'cancelled', requestId: '', answers: null, reason: 'none' }),
      transcriptRow: async () => {},
      transcriptDelta: async () => {},
      done: async () => {},
    },
  );
}

if (mode === 'hold') {
  const server = runtime(heldProvider());
  const harness = await server.openThread(THREAD);
  const root = await harness.root(ctx);
  await root.configure({ model: MODEL }, ctx);
  void root.submit({ type: 'input', content: 'log in', requestId: 'step-1' }, ctx);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(join(dir, `${THREAD}.sqlite`));
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.close();
  console.log('HELD');
  setInterval(() => {}, 60_000);
}

if (mode === 'resume') {
  const server = runtime();
  const harness = await server.openThread(THREAD);
  const started = Date.now();
  let terminal = false;
  while (!terminal && Date.now() - started < 20_000) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(join(dir, `${THREAD}.sqlite`), { readOnly: true });
    const row = db.prepare("select status from tasks where kind = '\"pi.generation\"'").get();
    db.close();
    terminal = row?.status === 'terminal';
  }
  const inspected = await harness.inspect(ctx);
  console.log(
    JSON.stringify(
      { tasks: inspected.tasks.map((task) => task.record.state) },
      (_key, value) => (typeof value === 'bigint' ? String(value) : value),
      2,
    ),
  );
  await server.close();
}
