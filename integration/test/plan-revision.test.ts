import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import type { TurnEvidence } from '../eval/chief-dispatch/stack.mts';
import {
  gradePlanRevisionCase,
  isPlanRevisionCase,
  type PlanRevisionCase,
} from '../eval/plan/grade.mts';
import { revisionPrompt } from '../eval/plan/run.mts';

const require = createRequire(new URL('../package.json', import.meta.url));
const loader = require.resolve('tsx/cli');
const runner = join(import.meta.dirname, '../eval/chief-dispatch/run-eval.mts');
const FLOW_DIR = join(import.meta.dirname, '../../.claude/hillclimb/plan');
const labeled = JSON.parse(
  readFileSync(join(import.meta.dirname, '../eval/plan/labeled-slice.json'), 'utf8'),
) as {
  examples: {
    id: string;
    caseId: string;
    expect: 'pass' | 'fail';
    todos: { id: string; title: string; spec: string }[];
  }[];
};
const flow = JSON.parse(readFileSync(join(FLOW_DIR, 'cases.json'), 'utf8')) as {
  roster: unknown[];
  cases: PlanRevisionCase[];
};
const byId = new Map(
  flow.cases.filter((c) => isPlanRevisionCase(c)).map((c) => [c.id, c] as const),
);

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function turn(over: Partial<TurnEvidence> = {}): TurnEvidence {
  return {
    threadId: 't',
    stepStatus: 'done',
    toolCalls: [],
    runBuildsArgs: [],
    assistantText: '',
    createdTodoIds: [],
    createdTodoRows: [],
    buildRows: [],
    model: 'glm-5.3',
    usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0 },
    wallMs: 100,
    ...over,
  };
}

describe('labeled slice', () => {
  test('alias variation passes', () => {
    const example = labeled.examples.find((e) => e.id === 'alias-variation-passes')!;
    const c = byId.get(example.caseId)!;
    expect(gradePlanRevisionCase(c, { evidence: turn(), todos: example.todos }).grade.plan_ok).toBe(
      1,
    );
  });

  test("repeating the ticket's own words (the Safari case) does not satisfy a root-cause requirement", () => {
    const example = labeled.examples.find((e) => e.id === 'prompt-echo-safari-fails')!;
    const c = byId.get(example.caseId)!;
    const g = gradePlanRevisionCase(c, { evidence: turn(), todos: example.todos });
    expect(g.grade.plan_ok).toBe(0);
    expect(g.explanation.plan_ok).toMatch(/missing fix/i);
  });

  test('a missing fix fails', () => {
    const example = labeled.examples.find((e) => e.id === 'missing-fix-fails')!;
    const c = byId.get(example.caseId)!;
    expect(gradePlanRevisionCase(c, { evidence: turn(), todos: example.todos }).grade.plan_ok).toBe(
      0,
    );
  });

  test('a dropped preserved step fails', () => {
    const example = labeled.examples.find((e) => e.id === 'dropped-preserved-step-fails')!;
    const c = byId.get(example.caseId)!;
    const g = gradePlanRevisionCase(c, { evidence: turn(), todos: example.todos });
    expect(g.grade.plan_ok).toBe(0);
    expect(g.explanation.plan_ok).toMatch(/dropped preserved|missing/i);
  });

  test('exponential backoff without jitter fails rev-004', () => {
    const example = labeled.examples.find((e) => e.id === 'rev-004-backoff-without-jitter-fails')!;
    const c = byId.get(example.caseId)!;
    const g = gradePlanRevisionCase(c, { evidence: turn(), todos: example.todos });
    expect(g.grade.plan_ok).toBe(0);
    expect(g.explanation.plan_ok).toMatch(/missing fix/i);
  });

  test('composite index without column pair fails rev-008', () => {
    const example = labeled.examples.find(
      (e) => e.id === 'rev-008-index-without-columns-fails',
    )!;
    const c = byId.get(example.caseId)!;
    const g = gradePlanRevisionCase(c, { evidence: turn(), todos: example.todos });
    expect(g.grade.plan_ok).toBe(0);
    expect(g.explanation.plan_ok).toMatch(/missing fix/i);
  });

  test('composite index without pagination fails rev-008', () => {
    const example = labeled.examples.find(
      (e) => e.id === 'rev-008-index-without-pagination-fails',
    )!;
    const c = byId.get(example.caseId)!;
    const g = gradePlanRevisionCase(c, { evidence: turn(), todos: example.todos });
    expect(g.grade.plan_ok).toBe(0);
    expect(g.explanation.plan_ok).toMatch(/dropped preserved|missing/i);
  });
});

describe('revision grader negative controls', () => {
  const sample = byId.get('rev-001-safari-download')!;

  test('feedback omitted fails', () => {
    const g = gradePlanRevisionCase(sample, {
      evidence: turn(),
      todos: [
        {
          id: 't1',
          title: 'Keep logging',
          spec: 'Add more logging and keep the regression test for the download path.',
        },
      ],
    });
    expect(g.grade.plan_ok).toBe(0);
  });

  test('feedback ignored fails', () => {
    const g = gradePlanRevisionCase(sample, {
      evidence: turn(),
      todos: [
        {
          id: 't1',
          title: 'More logging',
          spec: 'Add more logging to the export handler and keep the regression test for the download path.',
        },
      ],
    });
    expect(g.grade.plan_ok).toBe(0);
  });

  test('prior plan returned unchanged fails', () => {
    const prior = sample.priorPlan[0]!;
    const g = gradePlanRevisionCase(sample, {
      evidence: turn(),
      todos: [{ id: 't1', title: prior.title, spec: prior.spec }],
    });
    expect(g.grade.plan_ok).toBe(0);
  });

  test('an already-correct requirement dropped fails', () => {
    const g = gradePlanRevisionCase(sample, {
      evidence: turn(),
      todos: [
        {
          id: 't1',
          title: 'Fix download attribute',
          spec: 'Fix the download attribute on a blob url. No test step.',
        },
      ],
    });
    expect(g.grade.plan_ok).toBe(0);
    expect(g.explanation.plan_ok).toMatch(/dropped preserved/i);
  });

  test('assistant prose naming the fix does not substitute for todo artifacts', () => {
    const g = gradePlanRevisionCase(sample, {
      evidence: turn({
        assistantText:
          'Remove the download attribute on the blob url export and keep the regression test.',
      }),
      todos: [
        {
          id: 't1',
          title: 'investigate export',
          spec: 'look around the export path only',
        },
      ],
    });
    expect(g.grade.plan_ok).toBe(0);
    expect(g.explanation.plan_ok).toMatch(/missing fix/i);
  });
});

function chunk(payload: object): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function extractTodoId(messages: unknown[]): string | null {
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    const row = message as { role?: string; content?: unknown };
    if (row.role !== 'tool' || typeof row.content !== 'string') continue;
    try {
      const parsed = JSON.parse(row.content) as unknown;
      if (parsed && typeof parsed === 'object') {
        const obj = parsed as { id?: unknown; todos?: unknown };
        if (typeof obj.id === 'string') return obj.id;
        if (Array.isArray(obj.todos)) {
          for (const item of obj.todos) {
            if (
              item &&
              typeof item === 'object' &&
              typeof (item as { id?: unknown }).id === 'string'
            )
              return (item as { id: string }).id;
          }
        }
      }
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string')
            return (item as { id: string }).id;
        }
      }
    } catch {}
  }
  return null;
}

async function startRevisionStub(mode: 'feedback-fix' | 'control-unchanged'): Promise<{
  url: string;
  close: () => Promise<void>;
  prompts: string[];
}> {
  let turn = 0;
  const prompts: string[] = [];
  const server = createServer(async (request, response) => {
    const body = await new Promise<string>((resolve) => {
      let raw = '';
      request.on('data', (c) => {
        raw += c;
      });
      request.on('end', () => resolve(raw));
    });
    const parsed = JSON.parse(body) as {
      messages?: { role: string; content?: unknown }[];
      model?: string;
    };
    turn += 1;
    const user = [...(parsed.messages ?? [])].reverse().find((m) => m.role === 'user');
    if (typeof user?.content === 'string') prompts.push(user.content);
    else if (user?.content) prompts.push(JSON.stringify(user.content));
    const model = parsed.model ?? 'glm-5.3';
    const base = {
      id: 'rev-stub',
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
    if (turn === 1) emitTool('todos', {});
    else if (turn === 2) {
      const todoId = extractTodoId(parsed.messages ?? []) ?? 'missing-todo';
      if (mode === 'feedback-fix') {
        emitTool('update_todo', {
          todoId,
          title: 'Fix blob URL download',
          spec: 'Remove the download attribute on the blob url export path and keep the regression test for the download path.',
        });
      } else {
        response.write(
          chunk({
            ...base,
            choices: [{ index: 0, delta: { content: 'Plan looks fine as-is.' } }],
          }),
        );
        response.write(
          chunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
        );
      }
    } else {
      response.write(
        chunk({ ...base, choices: [{ index: 0, delta: { content: 'Revision done.' } }] }),
      );
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
    prompts,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

describe('revision execution', () => {
  test('the prior plan and the feedback reach the agent through the real revision sequence', async () => {
    const sample = byId.get('rev-001-safari-download')!;
    const home = mkdtempSync(join(tmpdir(), 'cairn-plan-rev-seq-'));
    homes.push(home);
    writeFileSync(
      join(home, 'cases.json'),
      JSON.stringify({
        roster: flow.roster,
        cases: [{ ...sample, id: 'rev-seq' }],
      }),
    );
    writeFileSync(join(home, '_state.json'), readFileSync(join(FLOW_DIR, '_state.json'), 'utf8'));
    const stub = await startRevisionStub('feedback-fix');
    try {
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
          '--arm',
          'feedback',
          '--reps',
          '1',
          '--concurrency',
          '1',
          '--timeout-s',
          '90',
          '--approve-harness',
          '--case',
          'rev-seq',
        ],
        {
          env: {
            ...process.env,
            TMPDIR: home,
            CAIRN_EVAL_RELAY_URL: stub.url,
            CAIRN_EVAL_RELAY_KEY: 'rev-seq',
          },
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
      const code = await new Promise<number | null>((resolve) => child.on('close', resolve));
      expect(code, output).toBe(0);
      expect(stub.prompts.some((p) => p.includes(sample.feedback))).toBe(true);
      expect(
        stub.prompts.some((p) => p.includes(revisionPrompt(sample, 'feedback').slice(0, 40))),
      ).toBe(true);
      const results = readFileSync(join(home, 'baseline/results.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { meta?: { arm?: string }; grade: { plan_ok: number } });
      expect(results.some((r) => r.meta?.arm === 'feedback')).toBe(true);
      expect(results.find((r) => r.meta?.arm === 'feedback')?.grade.plan_ok).toBe(1);
    } finally {
      await stub.close();
    }
  }, 180_000);

  test('the feedback arm fixes the named defect and keeps the existing test step; the no-feedback arm fails the same requirement', async () => {
    const sample = byId.get('rev-001-safari-download')!;
    const home = mkdtempSync(join(tmpdir(), 'cairn-plan-rev-pair-'));
    homes.push(home);
    writeFileSync(
      join(home, 'cases.json'),
      JSON.stringify({
        roster: flow.roster,
        cases: [{ ...sample, id: 'rev-pair' }],
      }),
    );
    writeFileSync(join(home, '_state.json'), readFileSync(join(FLOW_DIR, '_state.json'), 'utf8'));

    async function runArm(
      arm: 'feedback' | 'no-feedback',
      mode: 'feedback-fix' | 'control-unchanged',
    ) {
      const stub = await startRevisionStub(mode);
      try {
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
            '--arm',
            arm,
            '--reps',
            '1',
            '--concurrency',
            '1',
            '--timeout-s',
            '90',
            '--approve-harness',
            '--case',
            'rev-pair',
          ],
          {
            env: {
              ...process.env,
              TMPDIR: home,
              CAIRN_EVAL_RELAY_URL: stub.url,
              CAIRN_EVAL_RELAY_KEY: `rev-${arm}`,
            },
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
        const code = await new Promise<number | null>((resolve) => child.on('close', resolve));
        expect(code, output).toBe(0);
        return stub.prompts;
      } finally {
        await stub.close();
      }
    }

    await runArm('feedback', 'feedback-fix');
    await runArm('no-feedback', 'control-unchanged');
    const rows = readFileSync(join(home, 'baseline/results.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map(
        (line) =>
          JSON.parse(line) as {
            meta?: { arm?: string };
            grade: { plan_ok: number };
          },
      );
    const feedback = rows.find((r) => r.meta?.arm === 'feedback');
    const control = rows.find((r) => r.meta?.arm === 'no-feedback');
    expect(feedback?.grade.plan_ok).toBe(1);
    expect(control?.grade.plan_ok).toBe(0);
  }, 240_000);

  test('single-turn plan cases without revision fields still run', () => {
    const singles = JSON.parse(readFileSync(join(FLOW_DIR, 'cases.json'), 'utf8')) as {
      cases: { id: string; expect: { kind: string } }[];
    };
    expect(singles.cases.some((c) => c.expect.kind === 'plan')).toBe(true);
    expect(existsSync(join(import.meta.dirname, 'plan-flow.test.ts'))).toBe(true);
  });
});
