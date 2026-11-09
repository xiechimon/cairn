import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, test } from 'vitest';
import {
  buildStepDigest,
  COST_BASELINE_MIN_UNITS,
  type CostSample,
  costAnomaly,
  DIGEST_MAX_CHARS,
  type Observation,
  runShadow,
  STEP_DIGEST_NAME,
} from '../src/trajectory-shadow.js';

const T0 = Date.parse('2026-11-08T10:00:00.000Z');
const MIN = 60_000;
const DAY = 86_400_000;

function at(offsetMin: number): string {
  return new Date(T0 + offsetMin * MIN).toISOString();
}

function step(
  id: string,
  startMin: number,
  endMin: number,
  extra: Partial<Observation> = {},
): Observation {
  return {
    id,
    traceId: 'trace-1',
    type: 'SPAN',
    name: 'step session',
    startTime: at(startMin),
    endTime: at(endMin),
    parentObservationId: 'root',
    level: 'DEFAULT',
    environment: 'live',
    ...extra,
  };
}

function tool(
  id: string,
  parent: string,
  minute: number,
  name: string,
  input: unknown,
  extra: Partial<Observation> = {},
): Observation {
  return {
    id,
    traceId: 'trace-1',
    type: 'TOOL',
    name,
    startTime: at(minute),
    endTime: at(minute),
    parentObservationId: parent,
    level: 'DEFAULT',
    input: JSON.stringify(input),
    output: '{"ok":true}',
    ...extra,
  };
}

const rootObservation: Observation = {
  id: 'root-agent',
  traceId: 'trace-1',
  type: 'AGENT',
  name: 'invoke_agent',
  startTime: at(0),
  endTime: at(90),
  parentObservationId: null,
  metadata: { 'attributes.gen_ai.agent.name': 'Fix the commit identity check' },
};

test('the digest stays within its budget when tool calls carry huge payloads', () => {
  const unit = step('s1', 0, 30);
  const huge = 'x'.repeat(50_000);
  const tools = Array.from({ length: 200 }, (_, i) =>
    tool(
      `t${i}`,
      's1',
      i / 10,
      'bash',
      { command: `${huge}${i}` },
      { output: huge, level: 'ERROR' },
    ),
  );
  const questions = Array.from({ length: 40 }, (_, i) =>
    tool(`q${i}`, 's1', 25, 'ask_user', { questions: [{ question: `${huge}${i}` }] }),
  );
  const digest = buildStepDigest(unit, [unit, ...tools, ...questions], T0 + 60 * MIN);
  expect(JSON.stringify(digest).length).toBeLessThanOrEqual(DIGEST_MAX_CHARS);
  expect(digest.facts.tool_calls).toBe(240);
});

test('the digest redacts secrets that tool calls echoed', () => {
  const unit = step('s1', 0, 30);
  const secret = `sk-ant-api03-${'A'.repeat(40)}`;
  const digest = buildStepDigest(
    unit,
    [
      unit,
      tool(
        't1',
        's1',
        1,
        'bash',
        { command: `curl -H "x-api-key: ${secret}"` },
        { level: 'ERROR', output: secret },
      ),
    ],
    T0 + 60 * MIN,
  );
  expect(JSON.stringify(digest)).not.toContain(secret);
  expect(JSON.stringify(digest)).toContain('[REDACTED]');
});

test('the digest counts repeated identical calls and identical failures', () => {
  const unit = step('s1', 0, 30, { level: 'ERROR', statusMessage: 'git commit failed (1)' });
  const failing = { level: 'ERROR', output: 'pre-commit script failed (code 1)' };
  const digest = buildStepDigest(
    unit,
    [
      unit,
      tool('t1', 's1', 1, 'bash', { command: 'git commit -m x' }, failing),
      tool('t2', 's1', 2, 'read', { path: 'a.ts' }),
      tool('t3', 's1', 3, 'bash', { command: 'git commit -m x' }, failing),
      tool('t4', 's1', 4, 'Tool: bash', { command: 'git commit -m x' }, failing),
      tool('t5', 's1', 5, 'edit', { path: 'a.ts' }),
    ],
    T0 + 60 * MIN,
  );
  expect(digest.facts.max_same_call_repeats).toBe(3);
  expect(digest.facts.max_same_error_repeats).toBe(3);
  expect(digest.facts.tool_errors).toBe(3);
  expect(digest.facts.edits_or_writes).toBe(1);
  expect(digest.outcome).toEqual({
    status: 'error',
    error: 'git commit failed (1)',
    duration_min: 30,
  });
  expect(digest.last_tool_calls.map((c) => c.name)).toEqual([
    'bash',
    'read',
    'bash',
    'bash',
    'edit',
  ]);
});

test('the digest records idle time when no later unit started and the gap when one did', () => {
  const first = step('s1', 0, 10);
  const second = step('s2', 25, 40);
  const now = T0 + 100 * MIN;
  const trace = [first, second];
  expect(buildStepDigest(first, trace, now).after).toEqual({
    next_unit_started_after_min: 15,
    idle_min: null,
    build_finished: false,
  });
  expect(buildStepDigest(second, trace, now).after).toEqual({
    next_unit_started_after_min: null,
    idle_min: 60,
    build_finished: false,
  });
  const finished = buildStepDigest(second, [...trace, rootObservation], now);
  expect(finished.after.build_finished).toBe(true);
  expect(finished.task).toBe('Fix the commit identity check');
  expect(finished.phases.map((p) => [p.name, p.current === true])).toEqual([
    ['step session', false],
    ['step session', true],
  ]);
});

test('the digest lists owner question text from ask_user calls only', () => {
  const unit = step('s1', 0, 30);
  const digest = buildStepDigest(
    unit,
    [
      unit,
      tool('t1', 's1', 1, 'ask_user', {
        questions: [{ header: 'Auth', question: 'Which credential should I use?' }],
      }),
      tool('t2', 's1', 2, 'bash', { command: 'echo question: no' }),
    ],
    T0 + 60 * MIN,
  );
  expect(digest.owner_questions).toEqual(['Which credential should I use?']);
  expect(buildStepDigest(unit, [unit], T0).owner_questions).toEqual([]);
});

function sample(
  unitId: string,
  endedAt: number,
  cost: number,
  role = 'step session on gpt-6.1-sol',
): CostSample {
  return { unitId, role, endedAt, cost };
}

test('cost z-score uses only earlier same-name units from the trailing seven days', () => {
  const target = sample('target', T0, 5);
  const baseline = [1, 2, 3, 2, 2].map((cost, i) => sample(`b${i}`, T0 - (i + 1) * DAY, cost));
  const noise = [
    sample('other-kind', T0 - DAY, 100, 'step merge on gpt-6.1-sol'),
    sample('other-model', T0 - DAY, 100, 'step session on claude-sonnet-5-5'),
    sample('too-old', T0 - 8 * DAY, 100),
    sample('later', T0 + MIN, 100),
    target,
  ];
  const result = costAnomaly(target, [...baseline, ...noise]);
  expect(result?.n).toBe(5);
  expect(result?.mean).toBe(2);
  expect(result?.z).toBeCloseTo(3 / Math.sqrt(0.5), 2);
});

test('cost z-score is withheld when the baseline is too small or flat', () => {
  const target = sample('target', T0, 5);
  const few = Array.from({ length: COST_BASELINE_MIN_UNITS - 1 }, (_, i) =>
    sample(`b${i}`, T0 - (i + 1) * MIN, i),
  );
  expect(costAnomaly(target, few)).toBeNull();
  const flat = Array.from({ length: 10 }, (_, i) => sample(`b${i}`, T0 - (i + 1) * MIN, 1));
  expect(costAnomaly(target, flat)).toBeNull();
});

interface Recorded {
  digests: { parentSpanId: string; input: string }[];
  scores: { observationId: string; name: string; value: number }[];
}

const servers: Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

async function fakeLangfuse(observations: Observation[], recorded: Recorded): Promise<string> {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://local');
      if (url.pathname === '/api/public/v2/observations') {
        const q = url.searchParams;
        const data = observations.filter(
          (o) =>
            (!q.get('type') || o.type === q.get('type')) &&
            (!q.get('name') || o.name === q.get('name')) &&
            (!q.get('traceId') || o.traceId === q.get('traceId')),
        );
        res.end(JSON.stringify({ data, meta: { cursor: null } }));
        return;
      }
      if (url.pathname === '/api/public/scores') {
        recorded.scores.push(JSON.parse(body));
        res.end('{"id":"x"}');
        return;
      }
      if (url.pathname === '/otel/v1/traces') {
        const spans = JSON.parse(body).resourceSpans[0].scopeSpans[0].spans;
        for (const span of spans) {
          const input = span.attributes.find(
            (a: { key: string }) => a.key === 'langfuse.observation.input',
          ).value.stringValue;
          recorded.digests.push({ parentSpanId: span.parentSpanId, input });
          observations.push({
            id: span.spanId,
            traceId: span.traceId,
            type: 'SPAN',
            name: STEP_DIGEST_NAME,
            startTime: at(0),
            endTime: at(0),
            parentObservationId: span.parentSpanId,
          });
        }
        res.end('{}');
        return;
      }
      res.statusCode = 404;
      res.end();
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

test('a run marks each unit with a step_error score for the error-rate chart', async () => {
  const observations: Observation[] = [
    step('ok', 0, 10),
    step('failed', 12, 20, { level: 'ERROR', statusMessage: 'git commit failed' }),
  ];
  const recorded: Recorded = { digests: [], scores: [] };
  const host = await fakeLangfuse(observations, recorded);
  await runShadow(
    { host, publicKey: 'pk', secretKey: 'sk' },
    { url: new URL(`${host}/otel/v1/traces`), headers: {} },
    { now: T0 + 60 * MIN, sinceMs: DAY, settleMs: 0, dryRun: false },
  );
  const errorScores = recorded.scores
    .filter((s) => s.name === 'step_error')
    .map((s) => `${s.observationId}=${s.value}`);
  expect(errorScores.sort()).toEqual(['failed=1', 'ok=0']);
});

test('a second run writes no second digest for an already digested unit', async () => {
  const unit = step('s1', 0, 30);
  const observations: Observation[] = [
    unit,
    tool('t1', 's1', 1, 'ask_user', { questions: [{ question: 'Merge now?' }] }),
  ];
  const recorded: Recorded = { digests: [], scores: [] };
  const host = await fakeLangfuse(observations, recorded);
  const options = { now: T0 + 90 * MIN, sinceMs: DAY, settleMs: 30 * MIN, dryRun: false };
  const target = { host, publicKey: 'pk', secretKey: 'sk' };
  const otlp = { url: new URL(`${host}/otel/v1/traces`), headers: {} };
  const first = await runShadow(target, otlp, options);
  const second = await runShadow(target, otlp, options);
  expect(first).toMatchObject({ units: 1, digests: 1, questionUnits: 1 });
  expect(second).toMatchObject({ units: 1, digests: 0, skippedAlreadyDigested: 1 });
  expect(recorded.digests).toHaveLength(1);
  expect(recorded.digests[0]?.parentSpanId).toBe('s1');
  expect(JSON.parse(recorded.digests[0]?.input ?? '{}').owner_questions).toEqual(['Merge now?']);
});

test('a run scores cost against the trailing week and skips unpriced units', async () => {
  const observations: Observation[] = [];
  const costs = [1, 2, 3, 2, 2, 9];
  costs.forEach((cost, i) => {
    const id = `s${i}`;
    const startMin = -((costs.length - 1 - i) * 24 * 60) - 60;
    observations.push(step(id, startMin, startMin + 10, { traceId: `trace-${i}` }));
    observations.push({
      id: `g${i}`,
      traceId: `trace-${i}`,
      type: 'GENERATION',
      name: 'chat gpt',
      startTime: at(startMin + 1),
      endTime: at(startMin + 1),
      parentObservationId: id,
      totalCost: cost,
      providedModelName: 'gpt-6.1-sol',
    });
  });
  observations.push(step('no-gen', -50, -45, { traceId: 'trace-x' }));
  observations.push(step('unpriced', -40, -35, { traceId: 'trace-y' }));
  observations.push({
    id: 'g-unpriced',
    traceId: 'trace-y',
    type: 'GENERATION',
    name: 'LLM Call',
    startTime: at(-39),
    endTime: at(-39),
    parentObservationId: 'unpriced',
    totalCost: 0,
    providedModelName: 'gpt-6.1-sol',
  });
  const recorded: Recorded = { digests: [], scores: [] };
  const host = await fakeLangfuse(observations, recorded);
  const result = await runShadow(
    { host, publicKey: 'pk', secretKey: 'sk' },
    { url: new URL(`${host}/otel/v1/traces`), headers: {} },
    { now: T0, sinceMs: 2 * 60 * MIN, settleMs: 0, dryRun: false },
  );
  expect(result.units).toBe(3);
  const costScores = recorded.scores.filter((s) => s.name === 'cost_z');
  expect(costScores).toHaveLength(1);
  expect(costScores[0]).toMatchObject({ observationId: 's5' });
  expect(costScores[0]?.value).toBeCloseTo(7 / Math.sqrt(0.5), 1);
});
