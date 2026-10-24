import { findDuplicateTicket, ticketDedupeKey, ticketDedupeMarker } from '@cairn/shared';
import { and, eq, like, sql } from 'drizzle-orm';
import { build, message, step, todo } from '../db/schema.js';
import {
  type FetchLike,
  githubCreateIssue,
  githubRepoIssue,
  githubRepoIssues,
} from '../lib/github.js';
import { nowMs } from '../lib/ids.js';
import type { BuildDeps } from './builds.js';
import { githubRepoOfProject, projectOfTodo } from './git.js';
import { githubTokenOrNull } from './github-connection.js';
import { githubText } from './github-text.js';
import { insertMessageRow } from './transcript.js';

export const CI_FIX_GREEN_EVENT = '[correction:ci-fix-green] CI 修复后转绿，待归因。';

export async function drainCiCorrections(deps: BuildDeps, githubFetch: FetchLike): Promise<void> {
  const events = deps.db
    .select({
      eventId: message.id,
      buildId: build.id,
      prNumber: build.prNumber,
      todoId: todo.id,
      projectId: todo.projectId,
      teamId: todo.teamId,
    })
    .from(message)
    .innerJoin(build, eq(build.id, message.conversationId))
    .innerJoin(todo, eq(todo.id, build.todoId))
    .where(
      and(
        eq(message.role, 'system'),
        eq(message.content, CI_FIX_GREEN_EVENT),
        sql`not exists (select 1 from message ack where ack.id = 'correction:' || ${message.id})`,
      ),
    )
    .orderBy(message.createdAt)
    .limit(20)
    .all();
  for (const event of events) {
    const ref = githubRepoOfProject(projectOfTodo(deps.db, event));
    const token = githubTokenOrNull(deps, event.teamId);
    if (ref === null || token === null) continue;
    const prompts = deps.db
      .select({ prompt: step.prompt })
      .from(step)
      .where(
        and(
          eq(step.buildId, event.buildId),
          eq(step.kind, 'build'),
          eq(step.status, 'done'),
          like(step.prompt, '[ci-fix]%'),
        ),
      )
      .all();
    const categories = new Set(
      prompts.flatMap(({ prompt }) =>
        [...(prompt ?? '').matchAll(/^- (.+)（(?:failure|timed_out)）/gm)].map((match) =>
          githubText(match[1] ?? '')
            .trim()
            .toLowerCase(),
        ),
      ),
    );
    if (categories.size === 0) categories.add('unknown');
    const issues: { state: string; body: string | null }[] = [];
    for (let page = 1; ; page += 1) {
      const result = await githubRepoIssues(githubFetch, token, ref.owner, ref.repo, {
        state: 'open',
        page,
      });
      for (const issue of result.issues) {
        if (issue.labels.some((label) => label.name === 'correction')) {
          issues.push(await githubRepoIssue(githubFetch, token, ref.owner, ref.repo, issue.number));
        }
      }
      if (!result.hasMore) break;
      if (page >= 10) throw new Error('correction dedupe scan incomplete');
    }
    for (const category of categories) {
      const key = ticketDedupeKey({ category: `ci-fix:${category}`, paths: [] });
      if (findDuplicateTicket(key, issues)) continue;
      const body = [
        ticketDedupeMarker(key),
        `待归因事件：build ${event.buildId}，PR #${event.prNumber} 经过 ci-fix 且最终转绿。`,
        `检查类别：${category}。检查名是初步归类，根因需结合修复 diff 与日志确认。`,
        '按 docs/lessons/README.md 阶梯取最高可行防护级，同类合并；新闸必须拿真实失误做负对照，旧错变红、修复后变绿。',
        '涉及 AGENTS.md 或闸的保护路径时，合并留人。',
      ].join('\n\n');
      await githubCreateIssue(githubFetch, token, ref.owner, ref.repo, {
        title: `纠错待归因：ci-fix ${category}`,
        body,
        labels: ['correction', 'enhancement', 'needs-triage'],
      });
      issues.push({ state: 'open', body });
    }
    insertMessageRow(deps, event.buildId, {
      id: `correction:${event.eventId}`,
      role: 'system',
      content: 'CI 修复转绿事件已按检查类别去重，交由 correction 票归因。',
      createdAt: nowMs(),
    });
  }
}
