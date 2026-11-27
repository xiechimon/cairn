import {
  buildRestartPrompt,
  CONTINUE_PROMPTS,
  SESSION_BRIEF,
  SESSION_REWORK_BRIEF,
  transcriptPromptRowId,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { message, step } from '../src/db/schema.js';
import { startBuilds } from '../src/services/builds.js';
import { backfillTranscriptOrigins } from '../src/services/transcript-origin-backfill.js';
import { bootServer, insertMachine, postProject, req, seedSessionRoute } from './helpers.js';

const TITLE = 'Do a thing';
const SPEC = 'the spec';
const TASK_TEXT = `${TITLE}\n\n${SPEC}`;
const DELIVERY_SECTION = '成果文件交接位置：/home/u/.cairn/deliverables/conv-1/';

async function legacyWorld(s: ReturnType<typeof bootServer>) {
  const machineId = insertMachine(s);
  seedSessionRoute(s, { provider: 'p', modelId: 'm', machineId });
  const projectId = await postProject(s.app, 'Prompt provenance backfill');
  const response = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    title: TITLE,
    spec: SPEC,
  });
  const { id: todoId } = (await response.json()) as { id: string };
  const [started] = startBuilds(s.svc, { projectId, todoIds: [todoId] });
  const stepRow = s.db.select().from(step).where(eq(step.buildId, started!.id)).get()!;
  return { conversationId: started!.id, stepId: stepRow.id };
}

function legacyRow(
  conversationId: string,
  input: {
    id: string;
    content: unknown;
    createdAt: number;
    origin?: 'task-prompt' | 'synthetic' | 'user';
  },
) {
  return {
    id: input.id,
    conversationId,
    role: 'user' as const,
    content: input.content,
    createdAt: input.createdAt,
    origin: input.origin ?? null,
  };
}

test('a legacy task prompt row keeps its provenance when a delivery section the reader never learned follows it', async () => {
  const s = bootServer();
  const { conversationId, stepId } = await legacyWorld(s);
  s.db
    .insert(message)
    .values([
      legacyRow(conversationId, {
        id: transcriptPromptRowId(stepId),
        content: `${TASK_TEXT}\n\n${DELIVERY_SECTION}`,
        createdAt: 1,
      }),
      legacyRow(conversationId, {
        id: 'user-step-long-gone',
        content: `${TASK_TEXT}\n\n${DELIVERY_SECTION}`,
        createdAt: 2,
      }),
    ])
    .run();

  backfillTranscriptOrigins(s.db);

  const rows = s.db.select().from(message).where(eq(message.conversationId, conversationId)).all();
  expect(rows.every((row) => row.origin === 'task-prompt')).toBe(true);
});

test('legacy generated instructions are stamped synthetic and a person keeps the person marker', async () => {
  const s = bootServer();
  const { conversationId } = await legacyWorld(s);
  s.db
    .insert(message)
    .values([
      legacyRow(conversationId, { id: 'm-1', content: CONTINUE_PROMPTS.build, createdAt: 1 }),
      legacyRow(conversationId, {
        id: 'm-2',
        content: buildRestartPrompt('先跑 lint 再提交'),
        createdAt: 2,
      }),
      legacyRow(conversationId, { id: 'm-3', content: '圆角改成 6px 吧', createdAt: 3 }),
      legacyRow(conversationId, {
        id: 'm-4',
        content: '收到，谢谢',
        createdAt: 4,
        origin: 'synthetic',
      }),
      {
        id: 'a-1',
        conversationId,
        role: 'assistant' as const,
        content: [{ type: 'text', text: '好' }],
        createdAt: 5,
      },
    ])
    .run();

  const counts = backfillTranscriptOrigins(s.db);

  const origins = new Map(
    s.db
      .select()
      .from(message)
      .where(eq(message.conversationId, conversationId))
      .all()
      .map((row) => [row.id, row.origin]),
  );
  expect(origins.get('m-1')).toBe('synthetic');
  expect(origins.get('m-2')).toBe('synthetic');
  expect(origins.get('m-3')).toBe('user');
  expect(origins.get('m-4')).toBe('synthetic');
  expect(origins.get('a-1')).toBeNull();
  expect(counts).toEqual({ 'task-prompt': 0, synthetic: 2, user: 1 });
});

test('a second run stamps nothing: every row already carries its marker', async () => {
  const s = bootServer();
  const { conversationId } = await legacyWorld(s);
  s.db
    .insert(message)
    .values([legacyRow(conversationId, { id: 'm-1', content: '圆角改成 6px 吧', createdAt: 1 })])
    .run();

  expect(backfillTranscriptOrigins(s.db)).toEqual({ 'task-prompt': 0, synthetic: 0, user: 1 });
  expect(backfillTranscriptOrigins(s.db)).toEqual({ 'task-prompt': 0, synthetic: 0, user: 0 });
});

const LEGACY_SESSION_BRIEF_FIXTURE = [
  'You own this task end to end in one session. Work in this order:',
  '1. Plan: read the task and the code it touches, then post the plan as a Markdown checklist, one `- [ ]` line per step (what changes, which edge cases, how you will check it), before your first change; each time a step starts or finishes, post the whole checklist again with `- [~]` on the step in progress and `- [x]` on finished steps. Do not wait for approval; decide from the repository and state the assumptions you made.',
  '2. Write tests first: add or update tests that fail for the right reason before you change behavior.',
  '3. Implement: make the smallest change that passes the tests, commit on the work branch and push as your instructions say.',
  '4. Self-check with evidence: run the checks named in the task and the project instructions, run the new tests, and exercise the changed behavior the way a user would. Quote the commands and their results in your final message; do not claim a check you did not run.',
  'A subagent whose result you need must run in the foreground: wait for it in the same turn instead of launching it in the background and ending your turn.',
  'Before you finish or ask a question, call thread_report with one line (at most 200 characters, your own words) saying where the thread stands.',
].join('\n');

const LEGACY_REWORK_BRIEF_FIXTURE =
  'Rework request on this same session: keep the plan, tests and branch you already have, address the feedback below, rerun the self-check and quote the new evidence, then call thread_report.';

const CURRENT_SESSION_BRIEF_FIXTURE = [
  'You own this task end to end in one session. Work in this order:',
  '1. Plan by size: read the task and the code it touches. For a small or clear task — even across multiple files — skip planning questions and go straight to edge cases and implementation. Only when a task has genuine product/architectural trade-offs, unclear scope or acceptance criteria, or choices you cannot safely infer from the repo, call `ask_user` once BEFORE your first edit with 1 to 3 bundled guiding questions (mark a `recommended` option on each). When direction is best judged in code, push a draft PR on the work branch and call `ask_user` with the PR link to confirm before finishing.',
  '2. Edge cases first: before your first edit, post a short `Edge cases` list (3–5 concrete bullets: empty/null inputs, boundary values, failure paths, existing callers/state transitions). Keep it brief and proceed immediately on clear tasks.',
  '3. Tests first & clean implementation: add or update tests that fail for the right reason before changing behavior, implement the change cleanly to pass them, commit on the work branch, and push/land as repository instructions specify.',
  '4. Real acceptance (mandatory before finishing): unit tests alone are not acceptance. Exercise the changed behavior matching the task kind after your last edit and quote the exact commands and observed results:',
  '   - UI change: run the app, verify visually, and attach a screenshot with `attach_file` (label live app vs. fixture).',
  '   - API / server change: send a real request to the running server/handler and quote the response.',
  '   - CLI / script change: run the real command and quote the exit code and output.',
  '   - Docs / data / config change: open and check the produced or updated artifact or run the real validator/parser.',
  '   If the environment genuinely blocks real acceptance or pushing (sandbox, missing runtime, missing credentials), do NOT claim done — call `ask_user` stating what ran, what is missing, and how to unblock.',
  'A subagent whose result you need must run in the foreground: wait for it in the same turn instead of launching it in the background and ending your turn.',
  'Before you finish or ask a question, call thread_report with one line (at most 200 characters, your own words) saying where the thread stands.',
].join('\n');

const CURRENT_REWORK_BRIEF_FIXTURE =
  'Rework request on this same session: keep the branch and tests you already have, address the feedback below, run real acceptance matching the task kind (UI screenshot via attach_file, real API request/response, real CLI run, or opening and checking the artifact) and quote the new evidence, then call thread_report.';

const ACCEPTANCE_NUDGE_FIXTURE =
  '[cairn acceptance check] Real acceptance is missing before this task can finish.';

test('both historical and current session/rework brief rows and acceptance nudges are stamped synthetic', async () => {
  expect(SESSION_BRIEF).toBe(CURRENT_SESSION_BRIEF_FIXTURE);
  expect(SESSION_REWORK_BRIEF).toBe(CURRENT_REWORK_BRIEF_FIXTURE);

  const s = bootServer();
  const { conversationId } = await legacyWorld(s);
  s.db
    .insert(message)
    .values([
      legacyRow(conversationId, {
        id: 'legacy-brief-1',
        content: `${LEGACY_SESSION_BRIEF_FIXTURE}\n\n${TASK_TEXT}`,
        createdAt: 1,
      }),
      legacyRow(conversationId, {
        id: 'legacy-rework-1',
        content: `${LEGACY_REWORK_BRIEF_FIXTURE}\n\n请再验证一遍`,
        createdAt: 2,
      }),
      legacyRow(conversationId, {
        id: 'current-brief-1',
        content: `${CURRENT_SESSION_BRIEF_FIXTURE}\n\n${TASK_TEXT}`,
        createdAt: 3,
      }),
      legacyRow(conversationId, {
        id: 'current-rework-1',
        content: `${CURRENT_REWORK_BRIEF_FIXTURE}\n\n请再验证一遍`,
        createdAt: 4,
      }),
      legacyRow(conversationId, {
        id: 'acceptance-nudge-1',
        content: `${ACCEPTANCE_NUDGE_FIXTURE}\n\nMissing live UI screenshot.`,
        createdAt: 5,
      }),
    ])
    .run();

  const counts = backfillTranscriptOrigins(s.db);
  expect(counts).toEqual({ 'task-prompt': 0, synthetic: 5, user: 0 });
});
