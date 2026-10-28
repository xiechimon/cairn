import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { openMemoryDb } from '../../apps/server/src/db/client.js';
import { seed } from '../../apps/server/src/db/seed.js';
import { composeChiefSystemPrompt } from '../../apps/server/src/services/chief.js';
import { TeamStreamHub } from '../../apps/server/src/services/events.js';
import {
  applyPromptSet,
  CHIEF_CONVENTIONS_HEADER,
  type PromptSet,
  promptSetIdentity,
} from '../eval/chief-dispatch/prompt-set.mts';

const require = createRequire(new URL('../package.json', import.meta.url));
const loader = require.resolve('tsx/cli');
const runner = join(import.meta.dirname, '../eval/chief-dispatch/run-eval.mts');

const HOLD_CASE = {
  id: 'ps-hold',
  tags: ['hold'],
  prompt: '现在有几个任务在跑？',
  expect: { kind: 'hold' as const },
};

const LEARN_CASE = {
  id: 'ps-learn',
  family: 'learn' as const,
  tags: ['learn'],
  round1: 'Write branch instructions using trunk.',
  correction: 'Use main, not trunk.',
  round2: 'Prepare branch instructions for the default branch.',
  expect: { include: [['main']], exclude: ['trunk'] },
  oracle: { title: 'Branch', content: 'Use main.' },
};

const ROSTER = [
  {
    key: 'chief',
    displayName: '总管',
    modelId: 'glm-5.3',
    description: '编排与派发',
  },
  {
    key: 'doc',
    displayName: '文档',
    modelId: 'glm-5.3',
    description: '面向读者的文档产出',
  },
];

type RelayCapture = {
  url: string;
  requests: { model?: string; messages: { role: string; content?: unknown }[] }[];
  close: () => Promise<void>;
};

type RunResult = {
  code: number | null;
  output: string;
  requests: RelayCapture['requests'];
};

function sseReply(model: string, content: string): string {
  const chunk = (delta: object, finish: string | null, usage?: object) =>
    `data: ${JSON.stringify({
      id: 'ps-resume',
      model,
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta, finish_reason: finish }],
      ...(usage ? { usage } : {}),
    })}\n\n`;
  return (
    chunk({ role: 'assistant', content: '' }, null) +
    chunk({ content }, null) +
    chunk({}, 'stop', { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }) +
    'data: [DONE]\n\n'
  );
}

async function startRecordingRelay(model = 'glm-5.3'): Promise<RelayCapture> {
  const requests: RelayCapture['requests'] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
      res.writeHead(404).end();
      return;
    }
    let body = '';
    req.on('data', (d) => {
      body += d;
    });
    req.on('end', () => {
      const parsed = JSON.parse(body) as RelayCapture['requests'][number];
      requests.push(parsed);
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
      });
      res.end(sseReply(model, 'No active tasks.'));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no relay port');
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function writeFlow(home: string, cases: object[], state: Record<string, unknown> = {}): void {
  writeFileSync(join(home, 'cases.json'), JSON.stringify({ roster: ROSTER, cases }, null, 2));
  writeFileSync(join(home, '_state.json'), `${JSON.stringify(state, null, 2)}\n`);
}

function writeRows(home: string, variant: string, rows: object[]): string {
  const dir = join(home, variant);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'results.jsonl');
  writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
  return path;
}

function provenance(partial: {
  prompt_set: PromptSet;
  prompt_set_identity?: string;
  harness_sha: string;
  model?: string;
  thinking?: string | null;
  timeout_s?: number;
}) {
  return {
    prompt_set: partial.prompt_set,
    prompt_set_identity: partial.prompt_set_identity ?? promptSetIdentity(partial.prompt_set),
    harness_sha: partial.harness_sha,
    model: partial.model ?? 'glm-5.3',
    thinking: partial.thinking === undefined ? null : partial.thinking,
    timeout_s: partial.timeout_s ?? 30,
  };
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

async function runEval(home: string, args: string[], relay: RelayCapture): Promise<RunResult> {
  const defaults: string[] = [loader, runner, '--flow', home];
  if (!hasFlag(args, '--variant')) defaults.push('--variant', 'v1');
  if (!hasFlag(args, '--model')) defaults.push('--model', 'glm-5.3');
  if (!hasFlag(args, '--reps')) defaults.push('--reps', '1');
  if (!hasFlag(args, '--concurrency')) defaults.push('--concurrency', '1');
  if (!hasFlag(args, '--timeout-s')) defaults.push('--timeout-s', '30');
  const child = spawn(process.execPath, [...defaults, ...args], {
    env: {
      ...process.env,
      TMPDIR: home,
      CAIRN_EVAL_RELAY_URL: relay.url,
      CAIRN_EVAL_RELAY_KEY: 'test',
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
  const timer = setTimeout(() => child.kill('SIGTERM'), 90_000);
  let code: number | null;
  try {
    code = await new Promise<number | null>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    });
  } finally {
    clearTimeout(timer);
  }
  return { code, output, requests: [...relay.requests] };
}

function systemTexts(requests: RelayCapture['requests']): string[] {
  const texts: string[] = [];
  for (const req of requests) {
    for (const message of req.messages ?? []) {
      if (message.role !== 'system') continue;
      if (typeof message.content === 'string') texts.push(message.content);
      else if (Array.isArray(message.content)) {
        texts.push(
          message.content
            .map((part) =>
              typeof part === 'object' && part && 'text' in part
                ? String((part as { text: string }).text)
                : '',
            )
            .join(''),
        );
      }
    }
  }
  return texts;
}

let skillsDir: string | undefined;
function productionPrompt(): string {
  const db = openMemoryDb();
  const { user, team } = seed(db);
  skillsDir = skillsDir ?? mkdtempSync(join(tmpdir(), 'cairn-ps-skills-'));
  return composeChiefSystemPrompt({ db, hub: new TeamStreamHub(), user, skillsDir }, team.id);
}

afterAll(() => {
  if (skillsDir) rmSync(skillsDir, { recursive: true, force: true });
});

describe('prompt-set resume provenance', () => {
  test('legacy rows without provenance: exit 2, zero relay requests, results.jsonl byte-identical', async () => {
    const home = mkdtempSync(join(tmpdir(), 'cairn-ps-legacy-'));
    const relay = await startRecordingRelay();
    try {
      writeFlow(home, [HOLD_CASE]);
      const resultsPath = writeRows(home, 'v1', [
        { prompt_id: 'ps-hold', rep: 0, grade: { decision_ok: 1 } },
      ]);
      const before = readFileSync(resultsPath);
      const beforeStat = statSync(resultsPath);
      const result = await runEval(home, ['--approve-harness', '--prompt-set', 'current'], relay);
      expect(result.code, result.output).toBe(2);
      expect(relay.requests).toHaveLength(0);
      expect(Buffer.compare(readFileSync(resultsPath), before)).toBe(0);
      expect(statSync(resultsPath).mtimeMs).toBe(beforeStat.mtimeMs);
      expect(result.output).toMatch(/provenance|fresh|--variant/i);
    } finally {
      await relay.close();
      rmSync(home, { recursive: true, force: true });
    }
  }, 120_000);

  test('rows written with another model or harness_sha: exit 2 before any relay request', async () => {
    const home = mkdtempSync(join(tmpdir(), 'cairn-ps-model-'));
    const relay = await startRecordingRelay();
    try {
      writeFlow(home, [HOLD_CASE]);
      const seed = await runEval(home, ['--approve-harness', '--prompt-set', 'current'], relay);
      expect(seed.code, seed.output).toBe(0);
      const afterSeed = relay.requests.length;
      const resultsPath = join(home, 'v1/results.jsonl');
      const rows = readFileSync(resultsPath, 'utf8')
        .trim()
        .split('\n')
        .map(
          (line) =>
            JSON.parse(line) as {
              prompt_id: string;
              rep: number;
              provenance: ReturnType<typeof provenance>;
            },
        );
      const seeded = rows[0];
      if (seeded === undefined) throw new Error('missing seed row');
      expect(seeded.provenance.harness_sha).toBeTruthy();
      rows[0] = {
        ...seeded,
        provenance: {
          ...seeded.provenance,
          model: 'other-model',
          harness_sha: 'b'.repeat(64),
        },
      };
      writeFileSync(resultsPath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
      const result = await runEval(home, ['--prompt-set', 'current'], relay);
      expect(result.code, result.output).toBe(2);
      expect(relay.requests.length).toBe(afterSeed);
      expect(result.output).toMatch(/incompatible results\.jsonl provenance/);
      expect(result.output).toMatch(/fresh --variant/);
    } finally {
      await relay.close();
      rmSync(home, { recursive: true, force: true });
    }
  }, 180_000);

  test('rows written with --prompt-set current, rerun with --prompt-set cut into the same variant: exit 2 with a message naming a fresh --variant', async () => {
    const home = mkdtempSync(join(tmpdir(), 'cairn-ps-switch-'));
    const relay = await startRecordingRelay();
    try {
      writeFlow(home, [HOLD_CASE]);
      const first = await runEval(home, ['--approve-harness', '--prompt-set', 'current'], relay);
      expect(first.code, first.output).toBe(0);
      expect(relay.requests.length).toBeGreaterThan(0);
      const afterCurrent = relay.requests.length;
      const second = await runEval(home, ['--prompt-set', 'cut'], relay);
      expect(second.code, second.output).toBe(2);
      expect(relay.requests.length).toBe(afterCurrent);
      expect(second.output).toMatch(/--variant/);
      expect(second.output).toMatch(/fresh|incompatible|prompt-set|cut/i);
    } finally {
      await relay.close();
      rmSync(home, { recursive: true, force: true });
    }
  }, 180_000);

  test('mixed-arm rows in one variant dir: exit 2', async () => {
    const home = mkdtempSync(join(tmpdir(), 'cairn-ps-mixed-'));
    const relay = await startRecordingRelay();
    try {
      writeFlow(home, [HOLD_CASE]);
      const seed = await runEval(home, ['--approve-harness', '--prompt-set', 'current'], relay);
      expect(seed.code, seed.output).toBe(0);
      const afterSeed = relay.requests.length;
      const resultsPath = join(home, 'v1/results.jsonl');
      const rows = readFileSync(resultsPath, 'utf8')
        .trim()
        .split('\n')
        .map(
          (line) =>
            JSON.parse(line) as {
              prompt_id: string;
              rep: number;
              provenance: ReturnType<typeof provenance>;
            },
        );
      const base = rows[0];
      if (base === undefined) throw new Error('missing seed row');
      writeFileSync(
        resultsPath,
        `${[
          JSON.stringify(base),
          JSON.stringify({
            ...base,
            rep: 1,
            provenance: { ...base.provenance, prompt_set: 'cut' as PromptSet },
          }),
        ].join('\n')}\n`,
      );
      const result = await runEval(home, ['--prompt-set', 'current', '--reps', '2'], relay);
      expect(result.code, result.output).toBe(2);
      expect(relay.requests.length).toBe(afterSeed);
      expect(result.output).toMatch(/incompatible results\.jsonl provenance/);
    } finally {
      await relay.close();
      rmSync(home, { recursive: true, force: true });
    }
  }, 180_000);

  test('--approve-harness on a new harness does not make old rows reusable', async () => {
    const home = mkdtempSync(join(tmpdir(), 'cairn-ps-approve-'));
    const relay = await startRecordingRelay();
    try {
      const oldSha = 'd'.repeat(64);
      writeFlow(home, [HOLD_CASE], {
        harness_sha: oldSha,
        harness_paths: ['integration/eval/chief-dispatch/stack.mts'],
      });
      writeRows(home, 'v1', [
        {
          prompt_id: 'ps-hold',
          rep: 0,
          provenance: provenance({ prompt_set: 'current', harness_sha: oldSha }),
        },
      ]);
      const result = await runEval(home, ['--approve-harness', '--prompt-set', 'current'], relay);
      expect(result.code, result.output).toBe(2);
      expect(relay.requests).toHaveLength(0);
      const state = JSON.parse(readFileSync(join(home, '_state.json'), 'utf8')) as {
        harness_sha?: string;
      };
      expect(state.harness_sha).toBeTruthy();
      expect(state.harness_sha).not.toBe(oldSha);
    } finally {
      await relay.close();
      rmSync(home, { recursive: true, force: true });
    }
  }, 120_000);

  test('compatible resume with --reps 3 over 2 completed reps runs exactly rep 2', async () => {
    const home = mkdtempSync(join(tmpdir(), 'cairn-ps-resume-'));
    const relay = await startRecordingRelay();
    try {
      writeFlow(home, [HOLD_CASE]);
      const seedRun = await runEval(
        home,
        ['--approve-harness', '--prompt-set', 'current', '--reps', '2'],
        relay,
      );
      expect(seedRun.code, seedRun.output).toBe(0);
      expect(relay.requests.length).toBeGreaterThanOrEqual(2);
      const afterSeed = relay.requests.length;
      const rows = readFileSync(join(home, 'v1/results.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { rep: number; provenance?: { harness_sha: string } });
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.provenance?.harness_sha)).toBe(true);
      const resume = await runEval(home, ['--prompt-set', 'current', '--reps', '3'], relay);
      expect(resume.code, resume.output).toBe(0);
      expect(relay.requests.length - afterSeed).toBe(1);
      const all = readFileSync(join(home, 'v1/results.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { rep: number });
      expect(all.map((row) => row.rep).sort()).toEqual([0, 1, 2]);
    } finally {
      await relay.close();
      rmSync(home, { recursive: true, force: true });
    }
  }, 240_000);

  test('cut prompts are shorter than current prompts, and current prompts equal the production prompt bytes', async () => {
    const prod = productionPrompt();
    expect(applyPromptSet(prod, 'current')).toBe(prod);
    expect(prod).toContain(CHIEF_CONVENTIONS_HEADER);

    const home = mkdtempSync(join(tmpdir(), 'cairn-ps-length-'));
    const relay = await startRecordingRelay();
    try {
      writeFlow(home, [HOLD_CASE]);
      const current = await runEval(
        home,
        ['--approve-harness', '--prompt-set', 'current', '--variant', 'v1'],
        relay,
      );
      expect(current.code, current.output).toBe(0);
      const currentTexts = systemTexts(relay.requests);
      expect(currentTexts.length).toBeGreaterThan(0);
      const currentPrompt = currentTexts[0] ?? '';
      expect(currentPrompt).toContain('ADR 0026');
      expect(currentPrompt).toContain(CHIEF_CONVENTIONS_HEADER);

      relay.requests.length = 0;
      writeFlow(home, [HOLD_CASE], JSON.parse(readFileSync(join(home, '_state.json'), 'utf8')));
      if (existsSync(join(home, 'v2'))) rmSync(join(home, 'v2'), { recursive: true, force: true });
      const cut = await runEval(home, ['--prompt-set', 'cut', '--variant', 'v2'], relay);
      expect(cut.code, cut.output).toBe(0);
      const cutTexts = systemTexts(relay.requests);
      expect(cutTexts.length).toBeGreaterThan(0);
      const cutPrompt = cutTexts[0] ?? '';
      expect(cutPrompt.length).toBeLessThan(currentPrompt.length);
      expect(cutPrompt).not.toContain('ADR 0026');
      expect(cutPrompt).toContain('交付物优先于路径');
      expect(promptSetIdentity('cut')).not.toBe(promptSetIdentity('current'));
    } finally {
      await relay.close();
      rmSync(home, { recursive: true, force: true });
    }
  }, 240_000);

  test('learn cases receive the selected prompt set', async () => {
    const home = mkdtempSync(join(tmpdir(), 'cairn-ps-learn-'));
    const relay = await startRecordingRelay();
    try {
      writeFlow(home, [LEARN_CASE]);
      const result = await runEval(
        home,
        ['--approve-harness', '--prompt-set', 'cut', '--arm', 'no-memory'],
        relay,
      );
      expect(result.code, result.output).toBe(0);
      const texts = systemTexts(relay.requests);
      expect(texts.length).toBeGreaterThan(0);
      expect(texts.some((text) => text.includes('交付物优先于路径'))).toBe(true);
      expect(texts.every((text) => !text.includes('ADR 0026'))).toBe(true);
      const rows = readFileSync(join(home, 'v1/results.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map(
          (line) =>
            JSON.parse(line) as {
              provenance?: { prompt_set?: string; prompt_set_identity?: string };
            },
        );
      expect(rows[0]?.provenance?.prompt_set).toBe('cut');
      expect(rows[0]?.provenance?.prompt_set_identity).toBe(promptSetIdentity('cut'));
    } finally {
      await relay.close();
      rmSync(home, { recursive: true, force: true });
    }
  }, 240_000);
});

describe('prompt-set CLI surface', () => {
  test('rejects an unknown prompt set before work starts', () => {
    const home = mkdtempSync(join(tmpdir(), 'cairn-ps-cli-'));
    try {
      writeFlow(home, [HOLD_CASE]);
      const result = spawnSync(
        process.execPath,
        [loader, runner, '--flow', home, '--prompt-set', 'nope', '--approve-harness'],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            CAIRN_EVAL_RELAY_URL: 'http://127.0.0.1:9/v1',
            CAIRN_EVAL_RELAY_KEY: 'test',
          },
        },
      );
      expect(result.status).toBe(2);
      expect(result.stderr).toMatch(/--prompt-set/);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
