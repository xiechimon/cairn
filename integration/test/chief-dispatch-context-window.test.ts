import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
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

type ModelCaps = { id: string; contextWindow: number };
function modelsUnder(home: string): ModelCaps[] {
  const models: ModelCaps[] = [];
  for (const entry of readdirSync(home, { withFileTypes: true })) {
    const path = join(home, entry.name);
    if (entry.isDirectory()) models.push(...modelsUnder(path));
    else if (entry.name === 'models.json') {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as {
        providers?: Record<string, { models?: ModelCaps[] }>;
      };
      models.push(...(raw.providers?.['relay-186']?.models ?? []));
    }
  }
  return models;
}

test.each([
  { declared: undefined, expected: 128_000 },
  { declared: 1_000_000, expected: 1_000_000 },
])(
  'eval CLI materializes context $expected from declaration $declared',
  async ({ declared, expected }) => {
    const home = mkdtempSync(join(tmpdir(), 'cairn-context-cli-'));
    const hold = dataset.cases.find((c) => c.expect.kind === 'hold');
    if (hold === undefined) throw new Error('No hold fixture');
    writeFileSync(
      join(home, 'cases.json'),
      JSON.stringify({ ...dataset, cases: [{ ...hold, id: 'context-probe' }] }),
    );
    let observed: ModelCaps[] = [];
    let requests = 0;
    const server = createServer(async (request, response) => {
      for await (const _chunk of request) {
      }
      observed = modelsUnder(home);
      requests += 1;
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      const chunk = (delta: object, finish: string | null, usage?: object) =>
        `data: ${JSON.stringify({
          id: 'context-probe',
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
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('No local provider port');
    try {
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
        '30',
        '--approve-harness',
      ];
      if (declared !== undefined) args.push('--context-window', String(declared));
      const child = spawn(process.execPath, args, {
        env: {
          ...process.env,
          TMPDIR: home,
          CAIRN_EVAL_RELAY_URL: `http://127.0.0.1:${address.port}/v1`,
          CAIRN_EVAL_RELAY_KEY: 'nonsecret-context-probe',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', (chunk) => {
        output += chunk;
      });
      child.stderr.on('data', (chunk) => {
        output += chunk;
      });
      const timer = setTimeout(() => child.kill('SIGTERM'), 45_000);
      let code: number | null;
      try {
        code = await new Promise<number | null>((resolve, reject) => {
          child.on('error', reject);
          child.on('close', resolve);
        });
      } finally {
        clearTimeout(timer);
      }
      expect(code, output).toBe(0);
      expect(requests).toBe(1);
      expect(observed.find((model) => model.id === 'glm-5.3')?.contextWindow).toBe(expected);
      const other = observed.filter((model) => model.id !== 'glm-5.3');
      expect(other.length).toBeGreaterThan(0);
      expect(other.every((model) => model.contextWindow === 128_000)).toBe(true);
      const rows = readFileSync(join(home, 'baseline/results.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { meta?: { context_window?: number } });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.meta?.context_window).toBe(declared);
      const proofDirectory = process.env.CAIRN_CONTEXT_PROOF_DIR;
      if (proofDirectory) {
        writeFileSync(
          join(
            proofDirectory,
            declared === undefined ? 'window-default.json' : 'window-1000000.json',
          ),
          JSON.stringify(
            {
              providerMode: 'local stub',
              declared: declared ?? null,
              materializedModels: observed,
              recordedWindow: rows[0]?.meta?.context_window ?? null,
            },
            null,
            2,
          ).concat('\n'),
        );
      }
      console.log(
        JSON.stringify({
          providerMode: 'local stub',
          declared: declared ?? null,
          materializedModels: observed,
        }),
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(home, { recursive: true, force: true });
    }
  },
  60_000,
);

test.each(['0', '-1', '1.5', 'NaN', 'Infinity', '9007199254740992'])(
  'eval CLI rejects invalid context window %s',
  (value) => {
    const result = spawnSync(process.execPath, [loader, runner, '--context-window', value], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('usage: run-eval.mts');
  },
);

test('context-window requests for learn cases are rejected before model execution', () => {
  const home = mkdtempSync(join(tmpdir(), 'cairn-context-learn-'));
  try {
    writeFileSync(
      join(home, 'cases.json'),
      JSON.stringify({
        roster: dataset.roster,
        cases: [
          {
            id: 'learn-probe',
            family: 'learn',
            tags: [],
            round1: 'Write branch instructions.',
            correction: 'Use main.',
            round2: 'Prepare branch instructions.',
            expect: { include: [['main']], exclude: ['trunk'] },
            oracle: { title: 'Branch', content: 'Use main.' },
          },
        ],
      }),
    );
    const result = spawnSync(
      process.execPath,
      [loader, runner, '--flow', home, '--context-window', '1000000', '--approve-harness'],
      { encoding: 'utf8' },
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--context-window is not supported for learn cases');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
