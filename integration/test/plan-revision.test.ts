import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import type { RosterAgent } from '../eval/chief-dispatch/grade.mts';
import {
  gradePlanCase,
  gradePlanRevisionCase,
  isPlanCase,
  isPlanRevisionCase,
  type PlanCase,
  type PlanTodoRow,
} from '../eval/plan/grade.mts';
import { planRevisionHarnessError, runPlanRevisionCase } from '../eval/plan/run.mts';
import { seedPriorPlan } from '../eval/plan/seed.mts';

const require = createRequire(new URL('../package.json', import.meta.url));
const loader = require.resolve('tsx/cli');
const runner = join(import.meta.dirname, '../eval/chief-dispatch/run-eval.mts');
const planFlow = join(import.meta.dirname, '../../.claude/hillclimb/plan');

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function chunk(payload: object): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function foldMessages(messages: unknown[]): string {
  const parts: string[] = [];
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    const row = message as { role?: string; content?: unknown };
    if (typeof row.content === 'string') parts.push(row.content);
    else if (Array.isArray(row.content)) {
      for (const part of row.content) {
        if (part && typeof part === 'object' && 'text' in part)
          parts.push(String((part as { text: unknown }).text));
        else if (typeof part === 'string') parts.push(part);
      }
    }
  }
  return parts.join('\n').toLowerCase();
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

function extractTodoId(messages: unknown[], titleNeedle: string): string | null {
  const needle = titleNeedle.toLowerCase();
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    const row = message as { role?: string; content?: unknown };
    if (typeof row.content !== 'string') continue;
    try {
      const parsed = JSON.parse(row.content) as unknown;
      const items = Array.isArray(parsed)
        ? parsed
        : parsed &&
            typeof parsed === 'object' &&
            Array.isArray((parsed as { todos?: unknown }).todos)
          ? (parsed as { todos: unknown[] }).todos
          : [parsed];
      for (const item of items) {
        if (
          item &&
          typeof item === 'object' &&
          typeof (item as { id?: unknown }).id === 'string' &&
          typeof (item as { title?: unknown }).title === 'string' &&
          String((item as { title: string }).title)
            .toLowerCase()
            .includes(needle)
        ) {
          return (item as { id: string }).id;
        }
      }
    } catch {}
  }
  return null;
}

function toolNamesInMessages(messages: unknown[]): Set<string> {
  const names = new Set<string>();
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    const row = message as { role?: string; tool_calls?: { function?: { name?: string } }[] };
    for (const call of row.tool_calls ?? []) {
      if (typeof call.function?.name === 'string') names.add(call.function.name);
    }
  }
  return names;
}

async function startRevisionStub(opts: {
  mode: 'adaptive' | 'record';
  seen: { feedback: boolean; priorPlan: boolean; prompts: string[] };
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
    const messages = parsed.messages ?? [];
    const haystack = foldMessages(messages);
    if (opts.seen.prompts.length < 8) opts.seen.prompts.push(haystack.slice(0, 400));
    const hasFeedback =
      haystack.includes('reject this plan') &&
      haystack.includes('download attribute on a blob url');
    if (hasFeedback) opts.seen.feedback = true;
    if (
      haystack.includes('add logging to the export handler') ||
      haystack.includes('keep the existing regression test card')
    ) {
      opts.seen.priorPlan = true;
    }
    turn += 1;
    const model = parsed.model ?? 'glm-5.3';
    const base = {
      id: 'plan-revision-stub',
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
    const projectId = extractProjectId(messages) ?? 'missing-project';
    const called = toolNamesInMessages(messages);
    const wantsRevision = haystack.includes('revise the plan');
    const loggingId = extractTodoId(messages, 'add logging');
    if (called.has('update_todo') || called.has('create_todo')) {
      const text = 'Plan revised.';
      response.write(chunk({ ...base, choices: [{ index: 0, delta: { content: text } }] }));
      response.write(chunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }));
    } else if (!called.has('projects') && extractProjectId(messages) === null) {
      emitTool('projects', {});
    } else if (loggingId === null) {
      emitTool('todos', { projectId });
    } else if (opts.mode === 'adaptive' && wantsRevision && hasFeedback && loggingId !== null) {
      emitTool('update_todo', {
        todoId: loggingId,
        title: 'Fix Safari export',
        spec: 'Fix the download attribute on a blob url; keep the existing regression test card.',
      });
    } else if (opts.mode === 'adaptive' && wantsRevision && !hasFeedback && loggingId !== null) {
      emitTool('update_todo', {
        todoId: loggingId,
        title: 'Add logging',
        spec: 'Add logging to the export handler.',
      });
    } else {
      const text = 'Acknowledged.';
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
        '120',
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
    const timer = setTimeout(() => child.kill('SIGTERM'), 180_000);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

const priorPlan = [
  {
    title: 'Add logging',
    spec: 'Add logging to the export handler.',
  },
  {
    title: 'Regression test',
    spec: 'Keep the existing regression test card for the Safari export path.',
  },
];

const revisionCase: PlanCase = {
  id: 'plan-rev-safari-feedback',
  tags: ['plan', 'revision'],
  prompt: 'Export button does nothing on Safari. Write a plan.',
  priorPlan,
  feedback:
    'Reject this plan. Find the cause: it is the download attribute on a blob url. Keep the existing regression test card.',
  revisionPrompt: 'Revise the plan based on the feedback.',
  expect: {
    kind: 'plan',
    include: [
      ['download attribute', 'blob url'],
      ['test', 'regression'],
    ],
    exclude: ['more logging', 'only logging'],
    minSplits: 1,
    maxSplits: 4,
    mustFix: [['download attribute', 'blob url']],
    mustPreserve: [['regression test', 'existing regression test']],
  },
};

function finalTodos(rows: PlanTodoRow[]): PlanTodoRow[] {
  return rows;
}

describe('plan revision contract', () => {
  test('revision cases carry priorPlan, feedback, mustFix and mustPreserve', () => {
    expect(isPlanCase(revisionCase)).toBe(true);
    expect(isPlanRevisionCase(revisionCase)).toBe(true);
    expect(revisionCase.priorPlan?.length).toBe(2);
    expect(revisionCase.expect.mustFix?.length).toBeGreaterThan(0);
    expect(revisionCase.expect.mustPreserve?.length).toBeGreaterThan(0);
  });

  test('single-turn plan cases without revision fields still run', () => {
    const dataset = JSON.parse(readFileSync(join(planFlow, 'cases.json'), 'utf8')) as {
      cases: PlanCase[];
    };
    const single = dataset.cases.find((c) => !isPlanRevisionCase(c));
    expect(single).toBeDefined();
    expect(isPlanCase(single!)).toBe(true);
    expect(isPlanRevisionCase(single!)).toBe(false);
    const graded = gradePlanCase(single!, {
      evidence: {
        threadId: 't',
        stepStatus: 'done',
        toolCalls: [{ name: 'create_todo', arguments: {} }],
        runBuildsArgs: [],
        assistantText: '',
        createdTodoIds: ['t1'],
        createdTodoRows: [
          {
            id: 't1',
            title: 'Fix',
            spec: 'Fix download attribute on blob url; add a test',
            projectId: 'p',
            buildAgentId: null,
            planAgentId: null,
            phase: 'todo',
          },
        ],
        buildRows: [],
        model: 'glm-5.3',
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
        wallMs: 1,
      },
    });
    expect(typeof graded.grade.plan_ok).toBe('number');
  });
});

describe('gradePlanRevisionCase negative controls', () => {
  test('feedback omitted fails', () => {
    const g = gradePlanRevisionCase(revisionCase, {
      stepStatus: 'done',
      feedbackDelivered: false,
      finalTodos: finalTodos([
        {
          id: '1',
          title: 'Fix',
          spec: 'Fix the download attribute on a blob url; keep the existing regression test card.',
        },
      ]),
    });
    expect(g.grade.revision_ok).toBe(0);
    expect(g.explanation.revision_ok).toMatch(/feedback omitted|no feedback/i);
  });

  test('feedback ignored fails', () => {
    const g = gradePlanRevisionCase(revisionCase, {
      stepStatus: 'done',
      feedbackDelivered: true,
      finalTodos: finalTodos([
        {
          id: '1',
          title: 'Add more logging',
          spec: 'Expand logging around the export handler and leave the cause alone.',
        },
        {
          id: '2',
          title: 'Regression test',
          spec: 'Keep the existing regression test card for the Safari export path.',
        },
      ]),
    });
    expect(g.grade.revision_ok).toBe(0);
    expect(g.explanation.revision_ok).toMatch(/mustFix|missing|ignored/i);
  });

  test('prior plan returned unchanged fails', () => {
    const g = gradePlanRevisionCase(revisionCase, {
      stepStatus: 'done',
      feedbackDelivered: true,
      finalTodos: finalTodos(
        priorPlan.map((row, i) => ({ id: `p${i}`, title: row.title, spec: row.spec })),
      ),
    });
    expect(g.grade.revision_ok).toBe(0);
    expect(g.explanation.revision_ok).toMatch(/unchanged|prior plan/i);
  });

  test('an already-correct requirement dropped fails', () => {
    const g = gradePlanRevisionCase(revisionCase, {
      stepStatus: 'done',
      feedbackDelivered: true,
      finalTodos: finalTodos([
        {
          id: '1',
          title: 'Fix Safari export',
          spec: 'Fix the download attribute on a blob url only.',
        },
      ]),
    });
    expect(g.grade.revision_ok).toBe(0);
    expect(g.explanation.revision_ok).toMatch(/mustPreserve|dropped|preserve/i);
  });

  test('feedback arm that fixes and preserves passes', () => {
    const g = gradePlanRevisionCase(revisionCase, {
      stepStatus: 'done',
      feedbackDelivered: true,
      finalTodos: finalTodos([
        {
          id: '1',
          title: 'Fix Safari export',
          spec: 'Fix the download attribute on a blob url; keep the existing regression test card.',
        },
      ]),
    });
    expect(g.grade.revision_ok).toBe(1);
  });
});

describe('plan revision execution', () => {
  test('the prior plan and the feedback reach the agent through the real revision sequence', async () => {
    const seen = { feedback: false, priorPlan: false, prompts: [] as string[] };
    const stub = await startRevisionStub({ mode: 'record', seen });
    process.env.CAIRN_EVAL_RELAY_URL = stub.url;
    process.env.CAIRN_EVAL_RELAY_KEY = 'nonsecret-plan-revision-record';
    const dataset = JSON.parse(readFileSync(join(planFlow, 'cases.json'), 'utf8')) as {
      roster: RosterAgent[];
    };
    try {
      const result = await runPlanRevisionCase(revisionCase, {
        roster: dataset.roster,
        model: 'glm-5.3',
        timeoutMs: 90_000,
        arms: 'feedback',
      });
      expect(result.feedback).toBeDefined();
      expect(seen.feedback || seen.prompts.some((p) => p.includes('download attribute'))).toBe(
        true,
      );
      expect(seen.priorPlan || (result.feedback?.seededTodos.length ?? 0) > 0).toBe(true);
      expect(result.feedback!.stages.map((s) => s.name)).toEqual(
        expect.arrayContaining(['initial', 'rejection', 'revision']),
      );
    } finally {
      await stub.close();
      delete process.env.CAIRN_EVAL_RELAY_URL;
      delete process.env.CAIRN_EVAL_RELAY_KEY;
    }
  }, 180_000);

  test('the feedback arm fixes the named defect and keeps the existing test step; the no-feedback arm fails the same requirement', async () => {
    const seen = { feedback: false, priorPlan: false, prompts: [] as string[] };
    const stub = await startRevisionStub({ mode: 'adaptive', seen });
    process.env.CAIRN_EVAL_RELAY_URL = stub.url;
    process.env.CAIRN_EVAL_RELAY_KEY = 'nonsecret-plan-revision-pair';
    const dataset = JSON.parse(readFileSync(join(planFlow, 'cases.json'), 'utf8')) as {
      roster: RosterAgent[];
    };
    try {
      const result = await runPlanRevisionCase(revisionCase, {
        roster: dataset.roster,
        model: 'glm-5.3',
        timeoutMs: 90_000,
        arms: 'all',
      });
      expect(result.grade.grade.revision_ok).toBe(1);
      expect(result.grade.grade.nofeedback_ok).toBe(0);
      expect(
        result.feedback?.finalTodos.some((t) => /download attribute|blob url/i.test(t.spec)),
      ).toBe(true);
      expect(
        result.feedback?.finalTodos.some((t) => /regression test/i.test(`${t.title}\n${t.spec}`)),
      ).toBe(true);
      expect(result.control?.threadId).not.toBe(result.feedback?.threadId);
    } finally {
      await stub.close();
      delete process.env.CAIRN_EVAL_RELAY_URL;
      delete process.env.CAIRN_EVAL_RELAY_KEY;
    }
  }, 240_000);

  test('the two arms share no conversation, memory or repository state', async () => {
    const seen = { feedback: false, priorPlan: false, prompts: [] as string[] };
    const stub = await startRevisionStub({ mode: 'adaptive', seen });
    process.env.CAIRN_EVAL_RELAY_URL = stub.url;
    process.env.CAIRN_EVAL_RELAY_KEY = 'nonsecret-plan-revision-isolate';
    const dataset = JSON.parse(readFileSync(join(planFlow, 'cases.json'), 'utf8')) as {
      roster: RosterAgent[];
    };
    try {
      const result = await runPlanRevisionCase(revisionCase, {
        roster: dataset.roster,
        model: 'glm-5.3',
        timeoutMs: 90_000,
        arms: 'all',
      });
      expect(result.feedback?.home).toBeDefined();
      expect(result.control?.home).toBeDefined();
      expect(result.feedback?.home).not.toBe(result.control?.home);
      expect(result.control?.feedbackPresentInDb).toBe(false);
      expect(result.feedback?.feedbackPresentInDb).toBe(true);
    } finally {
      await stub.close();
      delete process.env.CAIRN_EVAL_RELAY_URL;
      delete process.env.CAIRN_EVAL_RELAY_KEY;
    }
  }, 240_000);

  test('a failed or missing arm is a harness error in errors.jsonl, never a score', async () => {
    const err = planRevisionHarnessError('missing control arm');
    expect(err.failure_class).toBe('harness_error');
    const dataset = JSON.parse(readFileSync(join(planFlow, 'cases.json'), 'utf8')) as {
      roster: RosterAgent[];
    };
    const home = mkdtempSync(join(tmpdir(), 'cairn-plan-rev-missing-'));
    homes.push(home);
    writeFileSync(
      join(home, 'cases.json'),
      `${JSON.stringify(
        {
          flow: 'plan',
          roster: dataset.roster,
          cases: [{ ...revisionCase, id: 'plan-rev-missing-arm' }],
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(join(home, '_state.json'), readFileSync(join(planFlow, '_state.json'), 'utf8'));
    const stub = await startRevisionStub({
      mode: 'record',
      seen: { feedback: false, priorPlan: false, prompts: [] },
    });
    try {
      const { code, output } = await runRunner(
        home,
        {
          TMPDIR: home,
          CAIRN_EVAL_RELAY_URL: stub.url,
          CAIRN_EVAL_RELAY_KEY: 'nonsecret-plan-revision-missing',
          CAIRN_PLAN_REVISION_FORCE_MISSING_ARM: 'control',
        },
        ['--case', 'plan-rev-missing-arm'],
      );
      expect(code, output).not.toBe(0);
      const errorsPath = join(home, 'baseline/errors.jsonl');
      expect(existsSync(errorsPath)).toBe(true);
      const errors = readFileSync(errorsPath, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { failure_class?: string; grade?: unknown });
      expect(errors.some((row) => row.failure_class === 'harness_error')).toBe(true);
      const resultsPath = join(home, 'baseline/results.jsonl');
      if (existsSync(resultsPath)) {
        const body = readFileSync(resultsPath, 'utf8').trim();
        if (body !== '') {
          for (const line of body.split('\n')) {
            const row = JSON.parse(line) as { grade?: { revision_ok?: number } };
            expect(row.grade?.revision_ok).toBeUndefined();
          }
        }
      }
    } finally {
      await stub.close();
    }
  }, 240_000);
});

describe('seedPriorPlan', () => {
  test('exports a seeder used by the revision path', () => {
    expect(typeof seedPriorPlan).toBe('function');
  });
});
