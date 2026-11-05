import { execFile } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { type ClaimedStep, type ProviderConfig, SESSION_BRIEF } from '@cairn/shared';
import { afterEach, expect, test, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../../scripts/test-tmpdir.mjs';
import { executeProductionTask } from './runner.mjs';

const roots: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const root of roots.splice(0)) releaseTestTempDir(root);
});

function fixture() {
  const root = makeTestTempDir('harbor-production-');
  roots.push(root);
  const taskDir = join(root, 'workspaces', 'task');
  mkdirSync(taskDir, { recursive: true });
  writeFileSync(join(taskDir, 'input.txt'), 'keep me\n');
  const claimed: ClaimedStep = {
    step: { id: 'step', buildId: 'task', kind: 'session', machineId: 'eval', createdAt: 1 },
    conversationId: 'task',
    session: { action: 'new', sessionId: null },
    instruction: 'Read input.txt and write answer.txt.',
    project: { id: 'project', name: 'Task', repo: null, instructions: 'Preserve existing files.' },
    agent: {
      id: 'worker',
      displayName: 'Worker',
      description: 'Production worker instructions.',
      provider: 'eval-model',
      modelId: 'fixture',
      thinkingLevel: 'low',
    },
    mcpServers: [],
  };
  return { root, taskDir, claimed };
}

async function model(mode: 'write' | 'fail' | 'hang' = 'write') {
  vi.stubEnv('CAIRN_CUSTOM_MODEL_REASONING', '1');
  const requests: Record<string, unknown>[] = [];
  const server = createServer(async (request, response) => {
    let text = '';
    for await (const chunk of request) text += chunk;
    const body = JSON.parse(text) as Record<string, unknown>;
    requests.push(body);
    if (mode === 'fail') {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'fixture refusal' } }));
      return;
    }
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    if (mode === 'hang') {
      response.write(': waiting\n\n');
      return;
    }
    const messages = body.messages as { role: string; content?: unknown }[];
    const responded = messages.some((message) => message.role === 'tool');
    if (
      responded &&
      !JSON.stringify(messages.filter((message) => message.role === 'tool')).includes(
        'Successfully wrote to answer.txt',
      )
    ) {
      response.end('data: [DONE]\n\n');
      return;
    }
    const delta = responded
      ? { role: 'assistant', content: 'Wrote the answer.' }
      : {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: 'write-answer',
              type: 'function',
              function: {
                name: 'write',
                arguments: JSON.stringify({ path: 'answer.txt', content: 'runtime tool result\n' }),
              },
            },
          ],
        };
    const chunk = (delta: object, finish: string | null) =>
      `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'fixture', choices: [{ index: 0, delta, finish_reason: finish }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`;
    response.end(
      `${chunk(delta, null)}${chunk({}, responded ? 'stop' : 'tool_calls')}data: [DONE]\n\n`,
    );
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Missing port');
  const provider: ProviderConfig = {
    kind: 'http',
    providerId: 'eval-model',
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    api: 'openai-completions',
    apiKey: 'fixture-only',
    models: [{ id: 'fixture', name: 'Fixture' }],
  };
  return { provider, requests };
}

test('real runStep and Pi backend preserve a gitless task and execute a model tool call', async () => {
  const fixtureData = fixture();
  const { provider, requests } = await model();
  const result = await executeProductionTask({ ...fixtureData, provider });
  expect(result.done.status).toBe('success');
  expect(readFileSync(join(fixtureData.taskDir, 'input.txt'), 'utf8')).toBe('keep me\n');
  expect(readFileSync(join(fixtureData.taskDir, 'answer.txt'), 'utf8')).toBe(
    'runtime tool result\n',
  );
  expect(requests).toHaveLength(2);
  expect(JSON.stringify(requests[0])).toContain('Production worker instructions.');
  expect(JSON.stringify(requests[0])).toContain('Preserve existing files.');
  expect(result.executorRecord).toMatchObject({
    backend: 'pi',
    model: 'eval-model/fixture',
    effort: 'low',
  });
  expect(result.executorRecord.harness_sha).toMatch(/^[a-f0-9]{64}$/);
  expect(result.artifacts['transcript.json']).toContain('Wrote the answer.');
  expect(result.tools.map((tool) => tool.name)).toContain('write');
});

test.each(['fail', 'hang'] as const)('provider %s is reported as failed', async (mode) => {
  const fixtureData = fixture();
  const { provider } = await model(mode);
  const result = await executeProductionTask({ ...fixtureData, provider, timeoutMs: 1000 });
  expect(result.done.status).toBe('failed');
  expect(result.done.errorMessage).toMatch(mode === 'hang' ? /timeout/ : /fixture refusal/);
});

test('refuses repo cloning and workspace mismatch before model execution', async () => {
  const fixtureData = fixture();
  const { provider, requests } = await model();
  await expect(
    executeProductionTask({ ...fixtureData, taskDir: join(fixtureData.root, 'wrong'), provider }),
  ).rejects.toThrow(/task workspace/);
  fixtureData.claimed.project = {
    id: 'project',
    name: 'Task',
    repo: { kind: 'local', cloneUrl: '/unavailable' },
  };
  await expect(executeProductionTask({ ...fixtureData, provider })).rejects.toThrow(/repo/);
  expect(requests).toHaveLength(0);
});

test('production skill selection and content determine the native executor record', async () => {
  const fixtureData = fixture();
  const { provider, requests } = await model();
  const skillsDir = join(fixtureData.root, 'skills');
  mkdirSync(join(skillsDir, 'fixture-skill'), { recursive: true });
  const skillPath = join(skillsDir, 'fixture-skill', 'SKILL.md');
  writeFileSync(
    skillPath,
    '---\nname: fixture-skill\ndescription: Runtime skill catalog probe\n---\nFirst skill content.\n',
  );
  if (fixtureData.claimed.agent == null) throw new Error('Missing fixture agent');
  fixtureData.claimed.agent.injectedSkills = ['fixture-skill'];
  const first = await executeProductionTask({ ...fixtureData, provider, skillsDir });
  expect(first.done.skillInjectionFacts?.injected).toEqual(['fixture-skill']);
  expect(JSON.stringify(requests[0])).toContain('Runtime skill catalog probe');
  writeFileSync(
    skillPath,
    '---\nname: fixture-skill\ndescription: Runtime skill catalog probe\n---\nChanged skill content.\n',
  );
  const changed = await executeProductionTask({ ...fixtureData, provider, skillsDir });
  expect(changed.executorRecord.harness_sha).not.toBe(first.executorRecord.harness_sha);
  fixtureData.claimed.agent.injectedSkills = [];
  const omitted = await executeProductionTask({ ...fixtureData, provider, skillsDir });
  expect(omitted.done.skillInjectionFacts?.injected).toEqual([]);
  expect(omitted.executorRecord.harness_sha).not.toBe(changed.executorRecord.harness_sha);
});

test('task CLI runs the production backend and exports native artifacts without provider credentials', async () => {
  const fixtureData = fixture();
  const { provider } = await model();
  const { apiKey: _unused, ...relayProvider } = provider;
  const descriptorPath = join(fixtureData.root, 'descriptor.json');
  const output = join(fixtureData.root, 'output');
  writeFileSync(
    descriptorPath,
    JSON.stringify({
      taskDir: fixtureData.taskDir,
      stateDir: fixtureData.root,
      claimed: fixtureData.claimed,
      provider: relayProvider,
    }),
  );
  const loader = createRequire(import.meta.url).resolve('tsx/cli');
  await promisify(execFile)(
    process.execPath,
    [loader, join(import.meta.dirname, 'run-task.mts'), descriptorPath, output],
    { timeout: 30_000 },
  );
  const record = JSON.parse(readFileSync(join(output, 'executor-record.json'), 'utf8'));
  const execution = readFileSync(join(output, 'execution.json'), 'utf8');
  expect(record).toMatchObject({ backend: 'pi', model: 'eval-model/fixture', effort: 'low' });
  expect(JSON.parse(execution).done.status).toBe('success');
  const nativeSession = readFileSync(join(output, 'session.jsonl'), 'utf8');
  expect(nativeSession).toContain('write-answer');
  expect(nativeSession).toContain('"thinkingLevel":"low"');
  expect(execution).not.toContain('fixture-only');
  if (process.env.VERIFY_EVIDENCE_DIR !== undefined) {
    cpSync(output, process.env.VERIFY_EVIDENCE_DIR, { recursive: true });
    writeFileSync(
      join(process.env.VERIFY_EVIDENCE_DIR, 'provenance.json'),
      JSON.stringify({
        providerMode: 'stateful-fake',
        runner: 'apps/daemon/src/runner.ts:runStep',
        backend: 'apps/daemon/src/backend/pi.ts:PiBackend',
        taskWorkspace: 'gitless-snapshot',
        modelCalls: 2,
        meteredCalls: 0,
      }),
    );
  }
});

test('production backend sends the configured effort to a reasoning-capable provider', async () => {
  vi.stubEnv('CAIRN_CUSTOM_MODEL_REASONING', '1');
  const fixtureData = fixture();
  const { provider, requests } = await model();
  const result = await executeProductionTask({ ...fixtureData, provider });
  expect(result.executorRecord.effort).toBe('low');
  expect(requests[0]?.reasoning_effort).toBe('low');
});

test('private state initialization preserves externally supplied workspace permissions', async () => {
  const fixtureData = fixture();
  const parent = dirname(fixtureData.taskDir);
  chmodSync(parent, 0o755);
  chmodSync(fixtureData.taskDir, 0o750);
  const parentMode = statSync(parent).mode & 0o777;
  const taskMode = statSync(fixtureData.taskDir).mode & 0o777;
  const { provider } = await model();
  const result = await executeProductionTask({ ...fixtureData, provider });
  expect(result.done.status).toBe('success');
  expect(statSync(parent).mode & 0o777).toBe(parentMode);
  expect(statSync(fixtureData.taskDir).mode & 0o777).toBe(taskMode);
  expect(statSync(join(fixtureData.root, 'daemon')).mode & 0o777).toBe(0o700);
});

test('current production session claims execute with their supplied session brief', async () => {
  const fixtureData = fixture();
  fixtureData.claimed.step.kind = 'session';
  fixtureData.claimed.instruction = `${SESSION_BRIEF}\n\n${fixtureData.claimed.instruction}`;
  const { provider, requests } = await model();
  const session = await executeProductionTask({ ...fixtureData, provider });
  expect(session.done.status).toBe('success');
  expect(JSON.stringify(requests[0])).toContain(JSON.stringify(SESSION_BRIEF).slice(1, -1));
  fixtureData.claimed.step.kind = 'build';
  const legacy = await executeProductionTask({ ...fixtureData, provider });
  expect(legacy.done.status).toBe('success');
  expect(session.executorRecord).toEqual(legacy.executorRecord);
});
