import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import type { RosterAgent } from '../eval/chief-dispatch/grade.mts';
import { isLearnCase } from '../eval/learn/grade.mts';
import { isMemoryCase } from '../eval/memory-regression/grade.mts';
import { isPlanCase } from '../eval/plan/grade.mts';
import { isRoutingCase } from '../eval/project-routing/grade.mts';

const require = createRequire(new URL('../package.json', import.meta.url));
const loader = require.resolve('tsx/cli');
const runner = join(import.meta.dirname, '../eval/chief-dispatch/run-eval.mts');
const planFlow = join(import.meta.dirname, '../../.claude/hillclimb/plan');
const chiefFlow = join(import.meta.dirname, '../../.claude/hillclimb/chief-dispatch');
const memoryFlow = join(import.meta.dirname, '../../.claude/hillclimb/memory-regression');
const routingFlow = join(import.meta.dirname, '../../.claude/hillclimb/project-routing');
const learnFlow = join(import.meta.dirname, '../../.claude/hillclimb/learn');

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function chunk(payload: object): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function extractProjectId(messages: unknown[]): string | null {
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    const row = message as { role?: string; content?: unknown };
    if (row.role !== 'tool' || typeof row.content !== 'string') continue;
    try {
      const parsed = JSON.parse(row.content) as unknown;
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (
          item &&
          typeof item === 'object' &&
          'id' in item &&
          'name' in item &&
          (item as { name?: unknown }).name === 'eval-project' &&
          typeof (item as { id?: unknown }).id === 'string'
        ) {
          return (item as { id: string }).id;
        }
      }
    } catch {}
  }
  return null;
}

async function startPlanStub(opts: {
  specs: string[];
  prose?: string;
}): Promise<{ url: string; close: () => Promise<void> }> {
  let turn = 0;
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST') {
      response.writeHead(404).end();
      return;
    }
    const body = await new Promise<string>((resolve) => {
      let raw = '';
      request.on('data', (c) => {
        raw += c;
      });
      request.on('end', () => resolve(raw));
    });
    const parsed = JSON.parse(body) as { messages?: unknown[]; model?: string };
    turn += 1;
    const model = parsed.model ?? 'glm-5.3';
    const base = {
      id: 'plan-stub',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
    };
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write(
      chunk({
        ...base,
        choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
      }),
    );
    const emitTool = (name: string, args: Record<string, unknown>) => {
      const callId = `call-${turn}-${name}`;
      response.write(
        chunk({
          ...base,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: callId,
                    type: 'function',
                    function: { name, arguments: '' },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        }),
      );
      response.write(
        chunk({
          ...base,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args) } }],
              },
              finish_reason: null,
            },
          ],
        }),
      );
      response.write(
        chunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }),
      );
    };
    if (turn === 1) {
      emitTool('projects', {});
    } else if (turn <= 1 + opts.specs.length) {
      const projectId = extractProjectId(parsed.messages ?? []) ?? 'missing-project';
      const spec = opts.specs[turn - 2] ?? opts.specs[0]!;
      emitTool('create_todo', {
        projectId,
        title: `Plan card ${turn - 1}`,
        spec,
      });
    } else {
      const text = opts.prose ?? 'Plan written.';
      response.write(chunk({ ...base, choices: [{ index: 0, delta: { content: text } }] }));
      response.write(chunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }));
    }
    response.write(
      chunk({
        ...base,
        choices: [],
        usage: {
          prompt_tokens: 20,
          completion_tokens: 30,
          total_tokens: 50,
          prompt_tokens_details: { cached_tokens: 0 },
        },
      }),
    );
    response.write('data: [DONE]\n\n');
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no stub port');
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

async function startTextStub(text: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(async (request, response) => {
    for await (const _ of request) {
    }
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const base = {
      id: 'text-stub',
      model: 'glm-5.3',
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }],
    };
    response.end(
      chunk(base) +
        chunk({
          ...base,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }) +
        'data: [DONE]\n\n',
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no stub port');
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

function runRunner(
  flowDir: string,
  env: NodeJS.ProcessEnv,
  extraArgs: string[] = [],
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        loader,
        runner,
        '--flow',
        flowDir,
        '--variant',
        'baseline',
        '--model',
        'glm-5.3',
        '--reps',
        '1',
        '--concurrency',
        '1',
        '--timeout-s',
        '90',
        '--approve-harness',
        ...extraArgs,
      ],
      {
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    child.stdout.on('data', (c) => {
      output += c;
    });
    child.stderr.on('data', (c) => {
      output += c;
    });
    const timer = setTimeout(() => child.kill('SIGTERM'), 120_000);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

function copyPlanFlow(home: string, cases: unknown[], roster: RosterAgent[]): void {
  writeFileSync(
    join(home, 'cases.json'),
    `${JSON.stringify({ flow: 'plan', roster, cases }, null, 2)}\n`,
  );
  writeFileSync(join(home, '_state.json'), readFileSync(join(planFlow, '_state.json'), 'utf8'));
}

describe('plan flow runner', () => {
  test('the plan flow seeds the stack, runs, and writes numeric plan_ok with explanations and traces to results.jsonl', async () => {
    const dataset = JSON.parse(readFileSync(join(planFlow, 'cases.json'), 'utf8')) as {
      roster: RosterAgent[];
      cases: {
        id: string;
        prompt: string;
        expect: {
          kind: string;
          include: string[][];
          exclude: string[];
          minSplits: number;
          maxSplits: number;
        };
      }[];
    };
    const passCase = dataset.cases.find((c) => c.expect.maxSplits === 1) ?? dataset.cases[0];
    if (passCase === undefined) throw new Error('no plan case');
    const home = mkdtempSync(join(tmpdir(), 'cairn-plan-flow-'));
    homes.push(home);
    copyPlanFlow(home, [{ ...passCase, id: 'plan-pass' }], dataset.roster);
    const stub = await startPlanStub({
      specs: [
        'Fix the download attribute on the Safari blob url export path and add a regression test.',
      ],
    });
    try {
      const { code, output } = await runRunner(home, {
        TMPDIR: home,
        CAIRN_EVAL_RELAY_URL: stub.url,
        CAIRN_EVAL_RELAY_KEY: 'nonsecret-plan-flow',
      });
      expect(code, output).toBe(0);
      const resultsPath = join(home, 'baseline/results.jsonl');
      expect(existsSync(resultsPath)).toBe(true);
      const rows = readFileSync(resultsPath, 'utf8')
        .trim()
        .split('\n')
        .map(
          (line) =>
            JSON.parse(line) as {
              grade: { plan_ok: number };
              explanation: { plan_ok: string };
              in_tokens: number;
              out_tokens: number;
            },
        );
      expect(rows).toHaveLength(1);
      expect(typeof rows[0]!.grade.plan_ok).toBe('number');
      expect(rows[0]!.grade.plan_ok).toBe(1);
      expect(typeof rows[0]!.explanation.plan_ok).toBe('string');
      expect(typeof rows[0]!.in_tokens).toBe('number');
      expect(typeof rows[0]!.out_tokens).toBe('number');
      const traces = readdirSync(join(home, 'baseline/traces'));
      expect(traces.some((name) => name.startsWith('plan-pass'))).toBe(true);
    } finally {
      await stub.close();
    }
  }, 180_000);

  test('a case with an unknown expect.kind exits nonzero instead of being graded by gradeCase', async () => {
    const dataset = JSON.parse(readFileSync(join(planFlow, 'cases.json'), 'utf8')) as {
      roster: RosterAgent[];
    };
    const home = mkdtempSync(join(tmpdir(), 'cairn-plan-unknown-'));
    homes.push(home);
    copyPlanFlow(
      home,
      [
        {
          id: 'unknown-kind',
          tags: ['bogus'],
          prompt: 'Say hello.',
          expect: { kind: 'not-a-real-kind' },
        },
      ],
      dataset.roster,
    );
    const stub = await startTextStub('Hello.');
    try {
      const { code, output } = await runRunner(home, {
        TMPDIR: home,
        CAIRN_EVAL_RELAY_URL: stub.url,
        CAIRN_EVAL_RELAY_KEY: 'nonsecret-plan-unknown',
      });
      expect(code, output).not.toBe(0);
      expect(output).toMatch(/unknown expect\.kind/i);
      const resultsPath = join(home, 'baseline/results.jsonl');
      if (existsSync(resultsPath)) {
        const body = readFileSync(resultsPath, 'utf8').trim();
        if (body !== '') {
          for (const line of body.split('\n')) {
            const row = JSON.parse(line) as { grade?: { decision_ok?: number } };
            expect(row.grade?.decision_ok).toBeUndefined();
          }
        }
      }
    } finally {
      await stub.close();
    }
  }, 180_000);
});

describe('sibling flows still reach their own graders', () => {
  test('chief-dispatch, memory-regression, project-routing and learn fixtures keep distinct graders', () => {
    const chief = JSON.parse(readFileSync(join(chiefFlow, 'cases.json'), 'utf8')) as {
      cases: { id: string; expect: { kind: string } }[];
    };
    const memory = JSON.parse(readFileSync(join(memoryFlow, 'cases.json'), 'utf8')) as {
      cases: { id: string; expect: { kind: string } }[];
    };
    const routing = JSON.parse(readFileSync(join(routingFlow, 'cases.json'), 'utf8')) as {
      cases: { id: string; expect: { kind: string } }[];
    };
    const learn = JSON.parse(readFileSync(join(learnFlow, 'cases.json'), 'utf8')) as {
      cases: { id: string; family?: string; expect: { include: string[][] } }[];
    };
    const plan = JSON.parse(readFileSync(join(planFlow, 'cases.json'), 'utf8')) as {
      cases: { id: string; expect: { kind: string } }[];
    };

    const c = chief.cases[0]!;
    const m = memory.cases[0]!;
    const r = routing.cases[0]!;
    const l = learn.cases[0]!;
    const p = plan.cases[0]!;

    expect(isPlanCase(p)).toBe(true);
    expect(isPlanCase(c as never)).toBe(false);
    expect(isPlanCase(m as never)).toBe(false);
    expect(isPlanCase(r as never)).toBe(false);
    expect(isPlanCase(l as never)).toBe(false);

    expect(isMemoryCase(m)).toBe(true);
    expect(isRoutingCase(r)).toBe(true);
    expect(isLearnCase(l)).toBe(true);
    expect(c.expect.kind === 'dispatch' || c.expect.kind === 'hold').toBe(true);
  });
});
