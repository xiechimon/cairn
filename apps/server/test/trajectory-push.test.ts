import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type TrajectoryPack, trajectoryPackSchema } from '@cairn/shared';
import { afterEach, expect, test, vi } from 'vitest';

vi.setConfig({ testTimeout: 30_000 });

interface OtlpValue {
  stringValue?: string;
  intValue?: string;
  doubleValue?: number;
  boolValue?: boolean;
  arrayValue?: { values: OtlpValue[] };
}
interface OtlpSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: { key: string; value: OtlpValue }[];
  status?: { code: number; message?: string };
}
interface Received {
  path: string;
  headers: IncomingHttpHeaders;
  raw: string;
  spans: OtlpSpan[];
}

const homes: string[] = [];
const servers: Server[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
  for (const server of servers.splice(0)) server.close();
});

async function receiver(status = 200) {
  const received: Received[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const body = JSON.parse(raw);
      received.push({
        path: req.url ?? '',
        headers: req.headers,
        raw,
        spans: body.resourceSpans.flatMap((r: { scopeSpans: { spans: OtlpSpan[] }[] }) =>
          r.scopeSpans.flatMap((s) => s.spans),
        ),
      });
      res.statusCode = status;
      res.end('{}');
    });
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  return { received, endpoint: `http://127.0.0.1:${port}/api/public/otel` };
}

function attr(span: OtlpSpan, key: string): OtlpValue | undefined {
  return span.attributes.find((a) => a.key === key)?.value;
}
function text(span: OtlpSpan, key: string) {
  return attr(span, key)?.stringValue;
}
function count(span: OtlpSpan, key: string) {
  return Number(attr(span, key)?.intValue);
}

const SECRET_TOKEN = 'sk-abcdefghijklmnopqrstuvwxyz0123456789';
const BEARER = 'Bearer abcdefghij.klmnop-qrstuv';

function piPack(): TrajectoryPack {
  return trajectoryPackSchema.parse({
    buildId: 'build-1',
    input: {
      spec: 'Implement export',
      sourceRef: null,
      baseSha: 'base-sha',
      persona: 'implementer',
      agentId: 'agent-1',
      model: 'relay/glm-5.3',
      skillInjection: null,
      blockerHandoff: null,
      harnessHash: 'harness-hash',
    },
    process: {
      steps: [
        {
          stepId: 'step-plan',
          kind: 'plan',
          checkpointCommit: null,
          transcript: [
            { role: 'user', content: [{ type: 'text', text: 'plan it' }], timestamp: 1_000 },
            {
              role: 'assistant',
              content: [{ type: 'text', text: 'plan done' }],
              provider: 'relay',
              model: 'glm-5.3',
              stopReason: 'stop',
              usage: { input: 11, output: 22, cacheRead: 3, cacheWrite: 4, cost: { total: 0.25 } },
              timestamp: 1_500,
            },
          ],
        },
        {
          stepId: 'step-build',
          kind: 'build',
          checkpointCommit: 'head-sha',
          transcript: [
            { role: 'user', content: [{ type: 'text', text: 'build it' }], timestamp: 2_000 },
            {
              role: 'assistant',
              content: [
                { type: 'text', text: 'running' },
                {
                  type: 'toolCall',
                  id: 'call-1',
                  name: 'bash',
                  arguments: { command: `curl -H "Authorization: ${BEARER}" x` },
                },
                { type: 'toolCall', id: 'call-2', name: 'read', arguments: { path: 'a.ts' } },
              ],
              provider: 'relay',
              model: 'glm-5.3',
              responseModel: 'glm-5.3-0901',
              stopReason: 'toolUse',
              usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, cost: { total: 0.5 } },
              timestamp: 2_100,
            },
            {
              role: 'system',
              toolCallId: 'call-1',
              toolName: 'bash',
              isError: false,
              content: [{ type: 'text', text: `key ${SECRET_TOKEN}` }],
              timestamp: 2_900,
            },
            {
              role: 'system',
              toolCallId: 'call-2',
              toolName: 'read',
              isError: true,
              content: [{ type: 'text', text: 'ENOENT' }],
              timestamp: 3_000,
            },
            {
              role: 'assistant',
              content: [{ type: 'text', text: 'finished' }],
              provider: 'relay',
              model: 'glm-5.3',
              stopReason: 'stop',
              usage: { input: 7, output: 8, cacheRead: 0, cacheWrite: 0, cost: { total: 0.1 } },
              timestamp: 3_100,
            },
          ],
        },
      ],
      plans: [],
      token_usage: [],
    },
    judgments: { plan: [], diff: [], gate_verdict: [], ciFixRounds: 2 },
    outcome: { merged: true, revertedWithin7d: false, fixedByLaterPr: null, costTotal: 0.85 },
  });
}

function writePacks(packs: TrajectoryPack[]) {
  const home = mkdtempSync(join(tmpdir(), 'cairn-push-'));
  homes.push(home);
  const file = join(home, 'packs.jsonl');
  writeFileSync(file, `${packs.map((p) => JSON.stringify(p)).join('\n')}\n`);
  return file;
}

function newHome() {
  const home = mkdtempSync(join(tmpdir(), 'cairn-push-home-'));
  homes.push(home);
  return home;
}

function push(args: string[], env: Record<string, string | undefined>) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((done) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'src/trajectory-push-cli.ts', ...args],
      {
        cwd: resolve(import.meta.dirname, '..'),
        env: {
          ...process.env,
          CAIRN_OTEL_ENDPOINT: undefined,
          CAIRN_OTEL_HEADERS: undefined,
          CAIRN_HOME: newHome(),
          ...env,
        },
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => {
      stdout += c;
    });
    child.stderr.on('data', (c) => {
      stderr += c;
    });
    child.on('close', (status) => done({ status, stdout, stderr }));
  });
}

test('maps one build to one trace: invoke_agent root, a span per step, chat and execute_tool under each step', async () => {
  const { received, endpoint } = await receiver();
  const file = writePacks([piPack()]);
  const result = await push([file], {
    CAIRN_OTEL_ENDPOINT: endpoint,
    CAIRN_OTEL_HEADERS: 'Authorization=Basic cGs6c2s=,x-langfuse-ingestion-version=4',
  });
  expect(result.status, result.stderr).toBe(0);
  expect(received).toHaveLength(1);
  const [request] = received;
  expect(request?.path).toBe('/api/public/otel/v1/traces');
  expect(request?.headers.authorization).toBe('Basic cGs6c2s=');
  expect(request?.headers['x-langfuse-ingestion-version']).toBe('4');
  expect(request?.headers['content-type']).toContain('application/json');
  const spans = request?.spans ?? [];
  expect(new Set(spans.map((s) => s.traceId)).size).toBe(1);
  expect(spans[0]?.traceId).toMatch(/^[0-9a-f]{32}$/);
  expect(new Set(spans.map((s) => s.spanId)).size).toBe(spans.length);
  for (const span of spans) expect(span.spanId).toMatch(/^[0-9a-f]{16}$/);

  const root = spans.find((s) => s.parentSpanId === undefined || s.parentSpanId === '');
  expect(root?.name).toBe('invoke_agent');
  expect(spans.filter((s) => !s.parentSpanId)).toHaveLength(1);
  const stepSpans = spans.filter((s) => s.parentSpanId === root?.spanId);
  expect(stepSpans.map((s) => text(s, 'cairn.step_id'))).toEqual(['step-plan', 'step-build']);
  expect(stepSpans.map((s) => text(s, 'cairn.step_kind'))).toEqual(['plan', 'build']);

  const children = (stepId: string) => {
    const parent = stepSpans.find((s) => text(s, 'cairn.step_id') === stepId);
    return spans.filter((s) => s.parentSpanId === parent?.spanId);
  };
  expect(children('step-plan').map((s) => text(s, 'gen_ai.operation.name'))).toEqual(['chat']);
  expect(children('step-build').map((s) => text(s, 'gen_ai.operation.name'))).toEqual([
    'chat',
    'execute_tool',
    'execute_tool',
    'chat',
  ]);
  expect(spans).toHaveLength(1 + 2 + 1 + 4);
});

test('carries GenAI convention fields and cairn.* fields', async () => {
  const { received, endpoint } = await receiver();
  const result = await push([writePacks([piPack()])], { CAIRN_OTEL_ENDPOINT: endpoint });
  expect(result.status, result.stderr).toBe(0);
  const spans = received[0]?.spans ?? [];
  const root = spans.find((s) => s.name === 'invoke_agent');
  expect(root).toBeDefined();
  if (!root) return;
  expect(text(root, 'gen_ai.operation.name')).toBe('invoke_agent');
  expect(text(root, 'gen_ai.provider.name')).toBe('relay');
  expect(text(root, 'gen_ai.request.model')).toBe('glm-5.3');
  expect(text(root, 'gen_ai.agent.id')).toBe('agent-1');
  expect(text(root, 'gen_ai.agent.name')).toBe('implementer');
  expect(text(root, 'cairn.build_id')).toBe('build-1');
  expect(text(root, 'cairn.base_sha')).toBe('base-sha');
  expect(text(root, 'cairn.harness_hash')).toBe('harness-hash');
  expect(text(root, 'cairn.persona')).toBe('implementer');
  expect(count(root, 'cairn.ci_fix_rounds')).toBe(2);
  expect(attr(root, 'cairn.outcome.merged')?.boolValue).toBe(true);
  expect(attr(root, 'cairn.outcome.reverted_within_7d')?.boolValue).toBe(false);
  expect(attr(root, 'cairn.outcome.fixed_by_later_pr')).toBeUndefined();
  expect(attr(root, 'cairn.cost_usd')?.doubleValue).toBe(0.85);

  const buildStep = spans.find((s) => text(s, 'cairn.step_id') === 'step-build');
  expect(text(buildStep as OtlpSpan, 'cairn.checkpoint_commit')).toBe('head-sha');

  const chats = spans.filter((s) => text(s, 'gen_ai.operation.name') === 'chat');
  expect(chats).toHaveLength(3);
  const toolTurn = chats[1] as OtlpSpan;
  expect(toolTurn.name).toBe('chat glm-5.3');
  expect(text(toolTurn, 'gen_ai.provider.name')).toBe('relay');
  expect(text(toolTurn, 'gen_ai.request.model')).toBe('glm-5.3');
  expect(text(toolTurn, 'gen_ai.response.model')).toBe('glm-5.3-0901');
  expect(attr(toolTurn, 'gen_ai.response.finish_reasons')?.arrayValue?.values).toEqual([
    { stringValue: 'toolUse' },
  ]);
  expect(count(toolTurn, 'gen_ai.usage.input_tokens')).toBe(100);
  expect(count(toolTurn, 'gen_ai.usage.output_tokens')).toBe(50);
  expect(attr(toolTurn, 'cairn.cost_usd')?.doubleValue).toBe(0.5);
  const planTurn = chats[0] as OtlpSpan;
  expect(count(planTurn, 'gen_ai.usage.cache_read.input_tokens')).toBe(3);
  expect(count(planTurn, 'gen_ai.usage.cache_creation.input_tokens')).toBe(4);
  expect(planTurn.status?.code ?? 0).not.toBe(2);

  const tools = spans.filter((s) => text(s, 'gen_ai.operation.name') === 'execute_tool');
  expect(tools.map((s) => s.name)).toEqual(['execute_tool bash', 'execute_tool read']);
  expect(tools.map((s) => text(s, 'gen_ai.tool.name'))).toEqual(['bash', 'read']);
  expect(tools.map((s) => text(s, 'gen_ai.tool.call.id'))).toEqual(['call-1', 'call-2']);
  expect(tools[0]?.status?.code ?? 0).not.toBe(2);
  expect(tools[1]?.status?.code).toBe(2);
  expect(BigInt(tools[0]?.startTimeUnixNano ?? 0)).toBe(2_100n * 1_000_000n);
  expect(BigInt(tools[0]?.endTimeUnixNano ?? 0)).toBe(2_900n * 1_000_000n);
  expect(BigInt(root.startTimeUnixNano)).toBe(1_000n * 1_000_000n);
  expect(BigInt(root.endTimeUnixNano)).toBe(3_100n * 1_000_000n);
});

test('pushing the same pack twice sends byte-identical trace and span ids', async () => {
  const { received, endpoint } = await receiver();
  const file = writePacks([piPack()]);
  const first = await push([file], { CAIRN_OTEL_ENDPOINT: endpoint });
  const second = await push([file], { CAIRN_OTEL_ENDPOINT: endpoint });
  expect(first.status, first.stderr).toBe(0);
  expect(second.status, second.stderr).toBe(0);
  expect(received).toHaveLength(2);
  const ids = (r?: Received) => r?.spans.map((s) => [s.traceId, s.spanId, s.parentSpanId]);
  expect(ids(received[1])).toEqual(ids(received[0]));
  expect(received[1]?.raw).toBe(received[0]?.raw);
});

test('different builds get different trace ids and disjoint span ids', async () => {
  const { received, endpoint } = await receiver();
  const other = { ...piPack(), buildId: 'build-2' };
  const result = await push([writePacks([piPack(), other])], { CAIRN_OTEL_ENDPOINT: endpoint });
  expect(result.status, result.stderr).toBe(0);
  expect(received).toHaveLength(2);
  expect(received[0]?.spans[0]?.traceId).not.toBe(received[1]?.spans[0]?.traceId);
  const spanIds = new Set(received.flatMap((r) => r.spans.map((s) => s.spanId)));
  expect(spanIds.size).toBe(received[0]!.spans.length * 2);
});

test('redacts secrets in every string that leaves the machine', async () => {
  const { received, endpoint } = await receiver();
  const result = await push([writePacks([piPack()])], { CAIRN_OTEL_ENDPOINT: endpoint });
  expect(result.status, result.stderr).toBe(0);
  const raw = received[0]?.raw ?? '';
  expect(raw).not.toContain(SECRET_TOKEN);
  expect(raw).not.toContain('abcdefghij.klmnop-qrstuv');
  expect(raw).toContain('[REDACTED]');
  expect(result.stdout).toMatch(/redacted=2\b/);
});

test('maps Claude session shapes: tool_use blocks, tool_result in user rows, snake_case usage', async () => {
  const { received, endpoint } = await receiver();
  const pack = piPack();
  pack.input.model = 'claude-code/claude-model';
  pack.process.steps = [
    {
      stepId: 'step-claude',
      kind: 'build',
      checkpointCommit: null,
      transcript: [
        {
          role: 'assistant',
          model: 'claude-model',
          stop_reason: 'tool_use',
          usage: { input_tokens: 5, output_tokens: 6 },
          content: [{ type: 'tool_use', id: 'tu-1', name: 'Bash', input: { command: 'ls' } }],
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: 'a.ts', is_error: false }],
        },
      ],
    },
  ];
  const result = await push([writePacks([pack])], { CAIRN_OTEL_ENDPOINT: endpoint });
  expect(result.status, result.stderr).toBe(0);
  const spans = received[0]?.spans ?? [];
  const chat = spans.find((s) => text(s, 'gen_ai.operation.name') === 'chat');
  expect(text(chat as OtlpSpan, 'gen_ai.provider.name')).toBe('claude-code');
  expect(text(chat as OtlpSpan, 'gen_ai.request.model')).toBe('claude-model');
  expect(attr(chat as OtlpSpan, 'gen_ai.response.finish_reasons')?.arrayValue?.values).toEqual([
    { stringValue: 'tool_use' },
  ]);
  expect(count(chat as OtlpSpan, 'gen_ai.usage.input_tokens')).toBe(5);
  expect(count(chat as OtlpSpan, 'gen_ai.usage.output_tokens')).toBe(6);
  const tool = spans.find((s) => text(s, 'gen_ai.operation.name') === 'execute_tool');
  expect(text(tool as OtlpSpan, 'gen_ai.tool.name')).toBe('Bash');
  expect(tool?.parentSpanId).toBe(chat?.parentSpanId);
});

test('a pack without steps or timestamps still yields a deterministic root span', async () => {
  const { received, endpoint } = await receiver();
  const pack = piPack();
  pack.process.steps = [];
  const file = writePacks([pack]);
  await push([file], { CAIRN_OTEL_ENDPOINT: endpoint });
  await push([file], { CAIRN_OTEL_ENDPOINT: endpoint });
  expect(received).toHaveLength(2);
  expect(received[0]?.spans).toHaveLength(1);
  expect(received[1]?.raw).toBe(received[0]?.raw);
});

test('accepts an endpoint that already ends with /v1/traces', async () => {
  const { received, endpoint } = await receiver();
  const result = await push([writePacks([piPack()])], {
    CAIRN_OTEL_ENDPOINT: `${endpoint}/v1/traces`,
  });
  expect(result.status, result.stderr).toBe(0);
  expect(received[0]?.path).toBe('/api/public/otel/v1/traces');
});

test.each([
  ['endpoint unset', {}, 'CAIRN_OTEL_ENDPOINT'],
  [
    'malformed headers',
    { CAIRN_OTEL_ENDPOINT: 'http://127.0.0.1:1', CAIRN_OTEL_HEADERS: 'nonsense' },
    'CAIRN_OTEL_HEADERS',
  ],
  ['endpoint not a url', { CAIRN_OTEL_ENDPOINT: 'not a url' }, 'CAIRN_OTEL_ENDPOINT'],
])('fails fast with a reason when %s', async (_name, env, reason) => {
  const result = await push([writePacks([piPack()])], env);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(reason);
});

test('rejects bad input before sending anything', async () => {
  const { received, endpoint } = await receiver();
  const home = mkdtempSync(join(tmpdir(), 'cairn-push-'));
  homes.push(home);
  const file = join(home, 'bad.jsonl');
  writeFileSync(file, `${JSON.stringify(piPack())}\n${JSON.stringify({ buildId: 'x' })}\n`);
  const invalid = await push([file], { CAIRN_OTEL_ENDPOINT: endpoint });
  expect(invalid.status).toBe(1);
  expect(invalid.stderr).toContain('Schema validation failed');
  const none = await push([], { CAIRN_OTEL_ENDPOINT: endpoint });
  expect(none.status).toBe(1);
  const missing = await push([join(home, 'missing.jsonl')], { CAIRN_OTEL_ENDPOINT: endpoint });
  expect(missing.status).toBe(1);
  expect(received).toHaveLength(0);
});

test('a non-2xx reply fails the run, names the status and leaks neither headers nor body', async () => {
  const { received, endpoint } = await receiver(401);
  const result = await push([writePacks([piPack(), piPack()])], {
    CAIRN_OTEL_ENDPOINT: endpoint,
    CAIRN_OTEL_HEADERS: 'Authorization=Basic c2VjcmV0LWNyZWQ=',
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('401');
  expect(result.stderr).not.toContain('c2VjcmV0LWNyZWQ=');
  expect(received).toHaveLength(1);
});

test('an unreachable endpoint fails the run without printing credentials in the url', async () => {
  const result = await push([writePacks([piPack()])], {
    CAIRN_OTEL_ENDPOINT: 'http://user:hunter2@127.0.0.1:1/otel',
  });
  expect(result.status).toBe(1);
  expect(result.stderr).not.toContain('hunter2');
  expect(result.stdout).not.toContain('hunter2');
});

test('a second push of the same traces to the same endpoint sends nothing and reports the skip', async () => {
  const { received, endpoint } = await receiver();
  const file = writePacks([piPack(), { ...piPack(), buildId: 'build-2' }]);
  const env = { CAIRN_OTEL_ENDPOINT: endpoint, CAIRN_HOME: newHome() };
  const first = await push([file], env);
  expect(first.status, first.stderr).toBe(0);
  expect(first.stdout).toMatch(/pushed=2 spans=16 .*skipped_already_pushed=0\b/);
  expect(received).toHaveLength(2);

  const second = await push([file], env);
  expect(second.status, second.stderr).toBe(0);
  expect(second.stdout).toMatch(/pushed=0 spans=0 .*skipped_already_pushed=2\b/);
  expect(received).toHaveLength(2);
});

test('only traces not yet pushed are sent when a later file adds a build', async () => {
  const { received, endpoint } = await receiver();
  const env = { CAIRN_OTEL_ENDPOINT: endpoint, CAIRN_HOME: newHome() };
  await push([writePacks([piPack()])], env);
  const next = await push([writePacks([piPack(), { ...piPack(), buildId: 'build-2' }])], env);
  expect(next.status, next.stderr).toBe(0);
  expect(next.stdout).toMatch(/pushed=1 .*skipped_already_pushed=1\b/);
  expect(received).toHaveLength(2);
  expect(text(received[1]?.spans[0] as OtlpSpan, 'cairn.build_id')).toBe('build-2');
});

test('--force pushes every span again', async () => {
  const { received, endpoint } = await receiver();
  const file = writePacks([piPack()]);
  const env = { CAIRN_OTEL_ENDPOINT: endpoint, CAIRN_HOME: newHome() };
  await push([file], env);
  const forced = await push(['--force', file], env);
  expect(forced.status, forced.stderr).toBe(0);
  expect(forced.stdout).toMatch(/pushed=1 spans=8 .*skipped_already_pushed=0\b/);
  expect(received).toHaveLength(2);
  expect(received[1]?.spans).toHaveLength(8);
  const after = await push([file], env);
  expect(after.stdout).toMatch(/pushed=0 .*skipped_already_pushed=1\b/);
  expect(received).toHaveLength(2);
});

test('a different endpoint is a different target and gets the full push', async () => {
  const one = await receiver();
  const two = await receiver();
  const file = writePacks([piPack()]);
  const home = newHome();
  await push([file], { CAIRN_OTEL_ENDPOINT: one.endpoint, CAIRN_HOME: home });
  const other = await push([file], { CAIRN_OTEL_ENDPOINT: two.endpoint, CAIRN_HOME: home });
  expect(other.status, other.stderr).toBe(0);
  expect(other.stdout).toMatch(/pushed=1 .*skipped_already_pushed=0\b/);
  expect(two.received).toHaveLength(1);
  expect(one.received).toHaveLength(1);
});

test('the record is keyed without credentials, so rotating the key does not repush', async () => {
  const { received, endpoint } = await receiver();
  const file = writePacks([piPack()]);
  const home = newHome();
  const withUser = endpoint.replace('http://', 'http://pk:sk1@');
  await push([file], { CAIRN_OTEL_ENDPOINT: withUser, CAIRN_HOME: home });
  const rotated = await push([file], {
    CAIRN_OTEL_ENDPOINT: endpoint.replace('http://', 'http://pk:sk2@'),
    CAIRN_HOME: home,
  });
  expect(rotated.stdout).toMatch(/skipped_already_pushed=1\b/);
  expect(received).toHaveLength(1);
});

test('traces delivered before a failure stay recorded and are skipped on retry', async () => {
  const { received, endpoint } = await receiver();
  const flaky = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.statusCode = flakyReplies.shift() ?? 200;
      res.end('{}');
    });
  });
  const flakyReplies = [200, 500];
  servers.push(flaky);
  await new Promise<void>((done) => flaky.listen(0, '127.0.0.1', done));
  const flakyEndpoint = `http://127.0.0.1:${(flaky.address() as AddressInfo).port}/otel`;
  const file = writePacks([piPack(), { ...piPack(), buildId: 'build-2' }]);
  const home = newHome();
  const failed = await push([file], { CAIRN_OTEL_ENDPOINT: flakyEndpoint, CAIRN_HOME: home });
  expect(failed.status).toBe(1);
  const retry = await push([file], { CAIRN_OTEL_ENDPOINT: endpoint, CAIRN_HOME: home });
  expect(retry.stdout).toMatch(/pushed=2 .*skipped_already_pushed=0\b/);
  const retrySame = await push([file], { CAIRN_OTEL_ENDPOINT: flakyEndpoint, CAIRN_HOME: home });
  expect(retrySame.status, retrySame.stderr).toBe(0);
  expect(retrySame.stdout).toMatch(/pushed=1 .*skipped_already_pushed=1\b/);
  expect(received).toHaveLength(2);
});
