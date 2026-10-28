import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

async function listenStub(mode: StubMode): Promise<string> {
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) {
    }
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
  return `http://127.0.0.1:${address.port}/v1`;
}

function flowHome(cases: Case[]): { home: string; out: string } {
  const home = mkdtempSync(join(tmpdir(), 'cairn-write-verify-'));
  scratch.push(home);
  writeFileSync(
    join(home, 'cases.json'),
    JSON.stringify({ roster: dataset.roster, cases }, null, 2),
  );
  return { home, out: join(home, 'harness-regression.json') };
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

describe('write-verify evidence (#2078)', () => {
  test('rejects --write-verify with --case or non-all --arm before publishing', () => {
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
      { encoding: 'utf8' },
    );
    expect(withCase.status).toBe(2);
    expect(`${withCase.stdout}${withCase.stderr}`).toMatch(/write-verify/i);
    expect(readFileSync(out)).toEqual(before);

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
      { encoding: 'utf8' },
    );
    expect(withArm.status).toBe(2);
    expect(`${withArm.stdout}${withArm.stderr}`).toMatch(/write-verify/i);
    expect(readFileSync(out)).toEqual(before);
  });

  test('a failed --write-verify run exits nonzero and leaves an existing result untouched', async () => {
    const url = await listenStub('fail');
    const { home, out } = flowHome([{ ...hold, id: 'wv-fail' }]);
    writeFileSync(out, `${PRIOR}\n`);
    const before = readFileSync(out);
    const got = await runEval(home, ['--write-verify', out, '--patch-digest', PATCH], {
      CAIRN_EVAL_RELAY_URL: url,
      CAIRN_EVAL_RELAY_KEY: 'nonsecret-write-verify',
    });
    expect(got.status, got.output).not.toBe(0);
    expect(readFileSync(out)).toEqual(before);
    expect(readdirSync(home).some((n) => n.includes('.tmp'))).toBe(false);
  }, 90_000);

  test('an interrupted --write-verify run never publishes and never damages an existing result', async () => {
    const url = await listenStub('hang');
    const { home, out } = flowHome([{ ...hold, id: 'wv-hang' }]);
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
        '8',
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
          CAIRN_EVAL_RELAY_URL: url,
          CAIRN_EVAL_RELAY_KEY: 'nonsecret-write-verify',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const closed = new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    await new Promise((r) => setTimeout(r, 1_500));
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await Promise.race([
      closed,
      new Promise<number | null>((resolve) => setTimeout(() => resolve(-1), 10_000)),
    ]);
    expect(readFileSync(out)).toEqual(before);
    expect(readdirSync(home).some((n) => n.includes('.tmp'))).toBe(false);
  }, 30_000);

  test('stale cached results.jsonl rows do not leak into published decision_ok', async () => {
    const url = await listenStub('ok');
    const { home, out } = flowHome([{ ...hold, id: 'wv-fresh' }]);
    mkdirSync(join(home, 'baseline'), { recursive: true });
    writeFileSync(
      join(home, 'baseline/results.jsonl'),
      `${JSON.stringify({
        prompt_id: 'stale-fail',
        rep: 0,
        grade: { decision_ok: 0, receipt_ok: 0 },
      })}\n${JSON.stringify({
        prompt_id: 'stale-fail-2',
        rep: 0,
        grade: { decision_ok: 0, receipt_ok: 0 },
      })}\n`,
    );
    const got = await runEval(home, ['--write-verify', out, '--patch-digest', PATCH], {
      CAIRN_EVAL_RELAY_URL: url,
      CAIRN_EVAL_RELAY_KEY: 'nonsecret-write-verify',
    });
    expect(got.status, got.output).toBe(0);
    const published = harnessRegressionResultSchema.parse(JSON.parse(readFileSync(out, 'utf8')));
    expect(published.patchDigest).toBe(PATCH);
    expect(published.harness_sha).toMatch(/^[0-9a-f]{64}$/);
    expect(published.trace_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(published.decision_ok).toBe(1);
  }, 90_000);

  test('a successful complete run publishes schema-valid evidence with digests', async () => {
    const url = await listenStub('ok');
    const { home, out } = flowHome([
      { ...hold, id: 'wv-a' },
      { ...hold, id: 'wv-b' },
    ]);
    const got = await runEval(
      home,
      ['--write-verify', out, '--patch-digest', PATCH],
      {
        CAIRN_EVAL_RELAY_URL: url,
        CAIRN_EVAL_RELAY_KEY: 'nonsecret-write-verify',
      },
      120_000,
    );
    expect(got.status, got.output).toBe(0);
    const published = harnessRegressionResultSchema.parse(JSON.parse(readFileSync(out, 'utf8')));
    expect(published.patchDigest).toBe(PATCH);
    expect(published.harness_sha).toMatch(/^[0-9a-f]{64}$/);
    expect(published.trace_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(published.decision_ok).toBe(1);
    const state = JSON.parse(readFileSync(join(home, '_state.json'), 'utf8')) as {
      harness_sha?: string;
    };
    expect(published.harness_sha).toBe(state.harness_sha);
    const traces = readdirSync(join(home, 'baseline/traces'))
      .filter((n) => n.endsWith('.json'))
      .sort()
      .map((n) => ({
        name: n,
        body: new Uint8Array(readFileSync(join(home, 'baseline/traces', n))),
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
