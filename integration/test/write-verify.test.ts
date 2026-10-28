import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { harnessRegressionResultSchema } from '@cairn/shared';
import { afterEach, describe, expect, test } from 'vitest';
import type { Case, RosterAgent } from '../eval/chief-dispatch/grade.mts';

const require = createRequire(new URL('../package.json', import.meta.url));
const loader = require.resolve('tsx/cli');
const runner = join(import.meta.dirname, '../eval/chief-dispatch/run-eval.mts');
const dataset = JSON.parse(
  readFileSync(
    join(import.meta.dirname, '../../.claude/hillclimb/chief-dispatch/cases.json'),
    'utf8',
  ),
) as { roster: RosterAgent[]; cases: Case[] };

const hold = dataset.cases.find((c) => c.expect.kind === 'hold');
if (hold === undefined) throw new Error('No hold fixture in chief-dispatch cases');

const PATCH = `pd2:${'a'.repeat(64)}`;
const PRIOR = JSON.stringify({
  patchDigest: 'prior-should-survive-failures',
  harness_sha: 'b'.repeat(64),
  decision_ok: 0.5,
  trace_digest: 'c'.repeat(64),
});

type StubMode = 'ok' | 'fail' | 'hang';

type RecordingRelay = {
  url: string;
  requests: () => number;
  waitForRequests: (n: number, ms?: number) => Promise<void>;
};

const scratch: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const dir of scratch.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function listenRecording(mode: StubMode): Promise<RecordingRelay> {
  let requests = 0;
  const waiters: { n: number; resolve: () => void }[] = [];
  const bump = () => {
    requests += 1;
    const pending = waiters.splice(0);
    for (const w of pending) {
      if (requests >= w.n) w.resolve();
      else waiters.push(w);
    }
  };
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) {
    }
    bump();
    if (mode === 'hang') {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(': keep-open\n\n');
      return;
    }
    if (mode === 'fail') {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'forced provider failure' } }));
      return;
    }
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const chunk = (delta: object, finish: string | null, usage?: object) =>
      `data: ${JSON.stringify({
        id: 'write-verify-probe',
        model: 'glm-5.3',
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta, finish_reason: finish }],
        ...(usage ? { usage } : {}),
      })}\n\n`;
    response.end(
      chunk({ role: 'assistant', content: 'No active tasks.' }, null) +
        chunk({}, 'stop', { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }) +
        'data: [DONE]\n\n',
    );
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('No local provider port');
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    requests: () => requests,
    waitForRequests: (n, ms = 60_000) =>
      new Promise<void>((resolve, reject) => {
        if (requests >= n) {
          resolve();
          return;
        }
        const timer = setTimeout(
          () => reject(new Error(`relay saw ${requests} requests, wanted ${n}`)),
          ms,
        );
        waiters.push({
          n,
          resolve: () => {
            clearTimeout(timer);
            resolve();
          },
        });
      }),
  };
}

function flowHome(cases: Case[]): { home: string; out: string; variant: string } {
  const home = mkdtempSync(join(tmpdir(), 'cairn-write-verify-'));
  scratch.push(home);
  writeFileSync(
    join(home, 'cases.json'),
    JSON.stringify({ roster: dataset.roster, cases }, null, 2),
  );
  return { home, out: join(home, 'harness-regression.json'), variant: join(home, 'baseline') };
}

function seedPassingVariant(
  variant: string,
  caseIds: string[],
): {
  results: Buffer;
  traces: Map<string, Buffer>;
} {
  mkdirSync(join(variant, 'traces'), { recursive: true });
  const rows = caseIds.map((id) =>
    JSON.stringify({
      prompt_id: id,
      rep: 0,
      grade: { decision_ok: 1, receipt_ok: 1 },
    }),
  );
  const resultsBody = Buffer.from(`${rows.join('\n')}\n`);
  writeFileSync(join(variant, 'results.jsonl'), resultsBody);
  const traces = new Map<string, Buffer>();
  for (const id of caseIds) {
    const name = `${id}_rep0.json`;
    const body = Buffer.from(JSON.stringify({ seeded: true, prompt_id: id }, null, 2));
    writeFileSync(join(variant, 'traces', name), body);
    traces.set(name, body);
  }
  return { results: resultsBody, traces };
}

function snapshotVariant(variant: string): { results: Buffer; traces: Map<string, Buffer> } {
  const results = existsSync(join(variant, 'results.jsonl'))
    ? readFileSync(join(variant, 'results.jsonl'))
    : Buffer.alloc(0);
  const traces = new Map<string, Buffer>();
  const tracesDir = join(variant, 'traces');
  if (existsSync(tracesDir)) {
    for (const name of readdirSync(tracesDir)
      .filter((n) => n.endsWith('.json'))
      .sort()) {
      traces.set(name, readFileSync(join(tracesDir, name)));
    }
  }
  return { results, traces };
}

function expectVariantByteIdentical(
  variant: string,
  prior: { results: Buffer; traces: Map<string, Buffer> },
) {
  const now = snapshotVariant(variant);
  expect(now.results.equals(prior.results)).toBe(true);
  expect([...now.traces.keys()]).toEqual([...prior.traces.keys()]);
  for (const [name, body] of prior.traces) {
    expect(now.traces.get(name)?.equals(body)).toBe(true);
  }
}

function writeVerifyRunDirs(home: string): string[] {
  return readdirSync(home)
    .filter((n) => n.startsWith('baseline.wv-') && statSync(join(home, n)).isDirectory())
    .sort();
}

function noTmpBeside(dest: string): void {
  const base = basename(dest);
  expect(
    readdirSync(dirname(dest)).filter((n) => n.includes('.tmp') || n.startsWith(`.${base}.`)),
  ).toEqual([]);
}

async function runEval(
  home: string,
  extra: string[],
  env: Record<string, string>,
  wallMs = 90_000,
): Promise<{ status: number | null; output: string }> {
  const args = [
    loader,
    runner,
    '--flow',
    home,
    '--variant',
    'baseline',
    '--model',
    'glm-5.3',
    '--reps',
    '1',
    '--concurrency',
    '1',
    '--timeout-s',
    '45',
    '--approve-harness',
    ...extra,
  ];
  const child = spawn(process.execPath, args, {
    env: { ...process.env, TMPDIR: home, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  const timer = setTimeout(() => child.kill('SIGTERM'), wallMs);
  let status: number | null;
  try {
    status = await new Promise<number | null>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    });
  } finally {
    clearTimeout(timer);
  }
  return { status, output };
}

async function closeChild(child: ChildProcess, ms = 10_000): Promise<number | null> {
  return Promise.race([
    new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    }),
    new Promise<number | null>((resolve) => setTimeout(() => resolve(-1), ms)),
  ]);
}

describe('write-verify evidence (#2078)', () => {
  test('rejects --write-verify with --case or non-all --arm before publishing', async () => {
    const relay = await listenRecording('ok');
    const { home, out } = flowHome([{ ...hold, id: 'wv-partial' }]);
    writeFileSync(out, `${PRIOR}\n`);
    const before = readFileSync(out);
    const withCase = spawnSync(
      process.execPath,
      [
        loader,
        runner,
        '--flow',
        home,
        '--variant',
        'baseline',
        '--approve-harness',
        '--write-verify',
        out,
        '--patch-digest',
        PATCH,
        '--case',
        'wv-partial',
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          TMPDIR: home,
          CAIRN_EVAL_RELAY_URL: relay.url,
          CAIRN_EVAL_RELAY_KEY: 'nonsecret-write-verify',
        },
      },
    );
    expect(withCase.status).toBe(2);
    expect(`${withCase.stdout}${withCase.stderr}`).toMatch(/write-verify/i);
    expect(readFileSync(out)).toEqual(before);
    expect(relay.requests()).toBe(0);

    const withArm = spawnSync(
      process.execPath,
      [
        loader,
        runner,
        '--flow',
        home,
        '--variant',
        'baseline',
        '--approve-harness',
        '--write-verify',
        out,
        '--patch-digest',
        PATCH,
        '--arm',
        'correction',
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          TMPDIR: home,
          CAIRN_EVAL_RELAY_URL: relay.url,
          CAIRN_EVAL_RELAY_KEY: 'nonsecret-write-verify',
        },
      },
    );
    expect(withArm.status).toBe(2);
    expect(`${withArm.stdout}${withArm.stderr}`).toMatch(/write-verify/i);
    expect(readFileSync(out)).toEqual(before);
    expect(relay.requests()).toBe(0);
  });

  test('a failed --write-verify run exits nonzero and leaves an existing result untouched', async () => {
    const relay = await listenRecording('fail');
    const { home, out, variant } = flowHome([{ ...hold, id: 'wv-fail' }]);
    const priorVariant = seedPassingVariant(variant, ['wv-fail']);
    writeFileSync(out, `${PRIOR}\n`);
    const before = readFileSync(out);
    const got = await runEval(home, ['--write-verify', out, '--patch-digest', PATCH], {
      CAIRN_EVAL_RELAY_URL: relay.url,
      CAIRN_EVAL_RELAY_KEY: 'nonsecret-write-verify',
    });
    expect(got.status, got.output).not.toBe(0);
    expect(readFileSync(out)).toEqual(before);
    expectVariantByteIdentical(variant, priorVariant);
    expect(relay.requests()).toBeGreaterThanOrEqual(1);
    noTmpBeside(out);
  }, 90_000);

  test('an interrupted --write-verify run never publishes and never damages an existing result', async () => {
    const relay = await listenRecording('hang');
    const { home, out, variant } = flowHome([{ ...hold, id: 'wv-hang' }]);
    const priorVariant = seedPassingVariant(variant, ['wv-hang']);
    writeFileSync(out, `${PRIOR}\n`);
    const before = readFileSync(out);
    const child = spawn(
      process.execPath,
      [
        loader,
        runner,
        '--flow',
        home,
        '--variant',
        'baseline',
        '--model',
        'glm-5.3',
        '--reps',
        '1',
        '--concurrency',
        '1',
        '--timeout-s',
        '30',
        '--approve-harness',
        '--write-verify',
        out,
        '--patch-digest',
        PATCH,
      ],
      {
        env: {
          ...process.env,
          TMPDIR: home,
          CAIRN_EVAL_RELAY_URL: relay.url,
          CAIRN_EVAL_RELAY_KEY: 'nonsecret-write-verify',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    await relay.waitForRequests(1, 60_000);
    expect(child.exitCode).toBeNull();
    expect(child.signalCode).toBeNull();
    child.kill('SIGTERM');
    const status = await closeChild(child, 15_000);
    expect(status, 'child should exit after SIGTERM').not.toBe(-1);
    expect(readFileSync(out)).toEqual(before);
    expectVariantByteIdentical(variant, priorVariant);
    noTmpBeside(out);
  }, 90_000);

  test('--write-verify ignores matching cached rows and runs every case fresh into a new per-run directory', async () => {
    const relay = await listenRecording('ok');
    const cases = [
      { ...hold, id: 'wv-fresh-a' },
      { ...hold, id: 'wv-fresh-b' },
    ];
    const { home, out, variant } = flowHome(cases);
    const priorVariant = seedPassingVariant(
      variant,
      cases.map((c) => c.id),
    );
    writeFileSync(out, `${PRIOR}\n`);
    const got = await runEval(
      home,
      ['--write-verify', out, '--patch-digest', PATCH],
      {
        CAIRN_EVAL_RELAY_URL: relay.url,
        CAIRN_EVAL_RELAY_KEY: 'nonsecret-write-verify',
      },
      120_000,
    );
    expect(got.status, got.output).toBe(0);
    expect(relay.requests()).toBe(cases.length);
    expectVariantByteIdentical(variant, priorVariant);
    const runDirs = writeVerifyRunDirs(home);
    expect(runDirs.length).toBe(1);
    const runResults = readFileSync(join(home, runDirs[0]!, 'results.jsonl'), 'utf8')
      .trim()
      .split('\n');
    expect(runResults).toHaveLength(cases.length);
    const published = harnessRegressionResultSchema.parse(JSON.parse(readFileSync(out, 'utf8')));
    expect(published.patchDigest).toBe(PATCH);
    expect(published.decision_ok).toBe(1);
    noTmpBeside(out);
  }, 120_000);

  test('a successful complete run publishes schema-valid evidence with digests and no temp file', async () => {
    const relay = await listenRecording('ok');
    const cases = [
      { ...hold, id: 'wv-a' },
      { ...hold, id: 'wv-b' },
    ];
    const { home, out, variant } = flowHome(cases);
    const priorVariant = seedPassingVariant(variant, ['wv-a', 'wv-b']);
    const got = await runEval(
      home,
      ['--write-verify', out, '--patch-digest', PATCH],
      {
        CAIRN_EVAL_RELAY_URL: relay.url,
        CAIRN_EVAL_RELAY_KEY: 'nonsecret-write-verify',
      },
      120_000,
    );
    expect(got.status, got.output).toBe(0);
    expect(relay.requests()).toBe(cases.length);
    expectVariantByteIdentical(variant, priorVariant);
    noTmpBeside(out);
    const published = harnessRegressionResultSchema.parse(JSON.parse(readFileSync(out, 'utf8')));
    expect(published.patchDigest).toBe(PATCH);
    expect(published.harness_sha).toMatch(/^[0-9a-f]{64}$/);
    expect(published.trace_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(published.decision_ok).toBe(1);
    const state = JSON.parse(readFileSync(join(home, '_state.json'), 'utf8')) as {
      harness_sha?: string;
    };
    expect(published.harness_sha).toBe(state.harness_sha);
    const runDirs = writeVerifyRunDirs(home);
    expect(runDirs).toHaveLength(1);
    const traces = readdirSync(join(home, runDirs[0]!, 'traces'))
      .filter((n) => n.endsWith('.json'))
      .sort()
      .map((n) => ({
        name: n,
        body: new Uint8Array(readFileSync(join(home, runDirs[0]!, 'traces', n))),
      }));
    const h = createHash('sha256');
    for (const f of traces) {
      h.update(f.name).update('\0').update(f.body).update('\0');
    }
    expect(published.trace_digest).toBe(h.digest('hex'));
  }, 120_000);
});

test('write-verify.test.ts is the worker preflight gate file', () => {
  expect(existsSync(join(import.meta.dirname, 'write-verify.test.ts'))).toBe(true);
});
