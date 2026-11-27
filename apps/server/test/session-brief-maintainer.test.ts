import { buildRestartPrompt, SESSION_BRIEF } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { message, step } from '../src/db/schema.js';
import { startBuilds } from '../src/services/build-start.js';
import { backfillTranscriptOrigins } from '../src/services/transcript-origin-backfill.js';
import { bootServer, insertMachine, postProject, req, seedSessionRoute } from './helpers.js';

const LEGACY_SESSION_BRIEF_LITERAL = [
  'You own this task end to end in one session. Work in this order:',
  '1. Plan: read the task and the code it touches, then post the plan as a Markdown checklist, one `- [ ]` line per step (what changes, which edge cases, how you will check it), before your first change; each time a step starts or finishes, post the whole checklist again with `- [~]` on the step in progress and `- [x]` on finished steps. Do not wait for approval; decide from the repository and state the assumptions you made.',
  '2. Write tests first: add or update tests that fail for the right reason before you change behavior.',
  '3. Implement: make the smallest change that passes the tests, commit on the work branch and push as your instructions say.',
  '4. Self-check with evidence: run the checks named in the task and the project instructions, run the new tests, and exercise the changed behavior the way a user would. Quote the commands and their results in your final message; do not claim a check you did not run.',
  'A subagent whose result you need must run in the foreground: wait for it in the same turn instead of launching it in the background and ending your turn.',
  'Before you finish or ask a question, call thread_report with one line (at most 200 characters, your own words) saying where the thread stands.',
].join('\n');

const LEGACY_TIERED_SESSION_BRIEF_LITERAL = [
  'You own this task end to end in one session. Work in this order:',
  '1. Plan by size: read the task and the code it touches. For a small or clear task — even across multiple files — skip planning questions and go straight to edge cases and implementation. Only when a task has genuine product/architectural trade-offs, unclear scope or acceptance criteria, or choices you cannot safely infer from the repo, call `ask_user` once BEFORE your first edit with 1 to 3 bundled guiding questions (mark a `recommended` option on each). When direction is best judged in code, push a draft PR on the work branch and call `ask_user` with the PR link to confirm before finishing.',
  '2. Edge cases first: before your first edit, post a short `Edge cases` list (3–5 concrete bullets: empty/null inputs, boundary values, failure paths, existing callers/state transitions). Keep it brief and proceed immediately on clear tasks.',
  '3. Tests first & smallest change: add or update tests that fail for the right reason before changing behavior, make the smallest change that passes them, commit on the work branch, and push/land as repository instructions specify.',
  '4. Real acceptance (mandatory before finishing): unit tests alone are not acceptance. Exercise the changed behavior matching the task kind after your last edit and quote the exact commands and observed results:',
  '   - UI change: run the app, verify visually, and attach a screenshot with `attach_file` (label live app vs. fixture).',
  '   - API / server change: send a real request to the running server/handler and quote the response.',
  '   - CLI / script change: run the real command and quote the exit code and output.',
  '   - Docs / data / config change: open and check the produced or updated artifact or run the real validator/parser.',
  '   If the environment genuinely blocks real acceptance or pushing (sandbox, missing runtime, missing credentials), do NOT claim done — call `ask_user` stating what ran, what is missing, and how to unblock.',
  'A subagent whose result you need must run in the foreground: wait for it in the same turn instead of launching it in the background and ending your turn.',
  'Before you finish or ask a question, call thread_report with one line (at most 200 characters, your own words) saying where the thread stands.',
].join('\n');

const UPDATED_SESSION_BRIEF_LITERAL = [
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

describe('SESSION_BRIEF reconciliation and transcript origin backfill', () => {
  test('SESSION_BRIEF removes smallest-change phrasing', () => {
    expect(SESSION_BRIEF.toLowerCase()).not.toContain('smallest change');
    expect(SESSION_BRIEF).toBe(UPDATED_SESSION_BRIEF_LITERAL);
  });

  test('backfill stamps both legacy and updated literals as synthetic without touching already-stamped rows', async () => {
    const s = bootServer();
    try {
      const machineId = insertMachine(s);
      seedSessionRoute(s, { provider: 'p', modelId: 'm', machineId });
      const projectId = await postProject(s.app, 'Session brief backfill');
      const created = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
        title: 'Implement parser',
        spec: 'Update email parser.',
      });
      const { id: todoId } = (await created.json()) as { id: string };
      const [started] = startBuilds(s.svc, { projectId, todoIds: [todoId] });
      const stepRow = s.db.select().from(step).where(eq(step.buildId, started!.id)).get()!;

      s.db
        .insert(message)
        .values([
          {
            id: 'legacy-standalone',
            conversationId: started!.id,
            role: 'user',
            content: LEGACY_SESSION_BRIEF_LITERAL,
            createdAt: 1,
            origin: null,
          },
          {
            id: 'legacy-with-restart',
            conversationId: started!.id,
            role: 'user',
            content: `${LEGACY_SESSION_BRIEF_LITERAL}\n\n${buildRestartPrompt('Retry cleanly')}`,
            createdAt: 2,
            origin: null,
          },
          {
            id: 'legacy-tiered-standalone',
            conversationId: started!.id,
            role: 'user',
            content: LEGACY_TIERED_SESSION_BRIEF_LITERAL,
            createdAt: 3,
            origin: null,
          },
          {
            id: 'legacy-tiered-with-restart',
            conversationId: started!.id,
            role: 'user',
            content: `${LEGACY_TIERED_SESSION_BRIEF_LITERAL}\n\n${buildRestartPrompt('Retry cleanly')}`,
            createdAt: 4,
            origin: null,
          },
          {
            id: 'new-standalone',
            conversationId: started!.id,
            role: 'user',
            content: UPDATED_SESSION_BRIEF_LITERAL,
            createdAt: 5,
            origin: null,
          },
          {
            id: 'new-with-restart',
            conversationId: started!.id,
            role: 'user',
            content: `${UPDATED_SESSION_BRIEF_LITERAL}\n\n${buildRestartPrompt('Retry cleanly')}`,
            createdAt: 6,
            origin: null,
          },
          {
            id: 'already-stamped-user',
            conversationId: started!.id,
            role: 'user',
            content: 'Please keep this user reply visible',
            createdAt: 7,
            origin: 'user',
          },
        ])
        .run();

      const counts = backfillTranscriptOrigins(s.db);
      const origins = new Map(
        s.db
          .select({ id: message.id, origin: message.origin })
          .from(message)
          .where(eq(message.conversationId, started!.id))
          .all()
          .map((row) => [row.id, row.origin]),
      );
      expect(origins.get('legacy-standalone')).toBe('synthetic');
      expect(origins.get('legacy-with-restart')).toBe('synthetic');
      expect(origins.get('legacy-tiered-standalone')).toBe('synthetic');
      expect(origins.get('legacy-tiered-with-restart')).toBe('synthetic');
      expect(origins.get('new-standalone')).toBe('synthetic');
      expect(origins.get('new-with-restart')).toBe('synthetic');
      expect(origins.get('already-stamped-user')).toBe('user');
      expect(counts.synthetic).toBe(6);
      expect(counts.user).toBe(0);
      expect(stepRow.prompt).toContain(UPDATED_SESSION_BRIEF_LITERAL);
    } finally {
      s.dispose();
    }
  }, 60_000);
});
