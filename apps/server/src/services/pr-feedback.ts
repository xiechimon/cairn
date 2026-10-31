import { neutralizeIssueAttachmentTokens } from '@cairn/shared';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { build, message, project, steerPending, step, team, todo } from '../db/schema.js';
import { type FetchLike, githubCollaboratorPermission, githubPull } from '../lib/github.js';
import { feedbackHighWaterSchema, githubPrFeedback } from '../lib/github-feedback.js';
import { conditionalFeedbackFetch } from '../lib/github-feedback-cache.js';
import { nowMs } from '../lib/ids.js';
import { type BuildDeps, enqueueStep } from './builds.js';
import { githubRepoOfProject } from './git.js';
import { teamGithubToken } from './github-connection.js';
import { publishStepRow } from './quota-wait.js';
import { setTodoPhase } from './todos.js';
import { insertMessageRow } from './transcript.js';

export const PR_FEEDBACK_INTERVAL_MS = 60_000;

export function createPrFeedbackPoller(
  deps: BuildDeps,
  run: { githubFetch: FetchLike; logger?: { info(obj: object, msg: string): void } },
) {
  let sweeping = false;
  const cachedFetch = conditionalFeedbackFetch(run.githubFetch);
  const permissions = new Map<string, { allowed: boolean; expiresAt: number }>();
  return {
    async sweep(): Promise<number> {
      if (sweeping) return 0;
      sweeping = true;
      let delivered = 0;
      try {
        for (const row of deps.db.select({ id: team.id }).from(team).all()) {
          const id = `github-feedback-start:${row.id}`;
          deps.db
            .insert(message)
            .values({
              id,
              conversationId: id,
              role: 'system',
              content: { kind: 'github_feedback_start' },
              createdAt: nowMs(),
            })
            .onConflictDoNothing()
            .run();
        }
        const targets = deps.db
          .select({ build, todo, project })
          .from(build)
          .innerJoin(todo, eq(todo.id, build.todoId))
          .innerJoin(project, eq(project.id, todo.projectId))
          .where(
            and(
              eq(todo.latestBuildId, build.id),
              isNull(todo.archivedAt),
              isNotNull(build.prNumber),
              inArray(todo.phase, [
                'queued',
                'planning',
                'building',
                'review',
                'confirm',
                'failed',
                'done',
              ]),
            ),
          )
          .all();
        for (const target of targets) {
          try {
            const ref = githubRepoOfProject(target.project);
            if (ref === null || target.build.prNumber === null) continue;
            const access = await teamGithubToken(deps, target.todo.teamId);
            if (!('token' in access)) continue;
            const page = await githubPull(
              cachedFetch,
              access.token,
              ref.owner,
              ref.repo,
              target.build.prNumber,
            );
            const pull = page?.pull;
            if (pull?.state !== 'open' || pull.merged) continue;
            const snapshot = await githubPrFeedback(
              cachedFetch,
              access.token,
              ref.owner,
              ref.repo,
              target.build.prNumber,
            );
            const cursorId =
              `github-feedback-baseline:${target.todo.teamId}:${ref.owner}/${ref.repo}:${target.build.prNumber}`.toLowerCase();
            const cursor = deps.db.select().from(message).where(eq(message.id, cursorId)).get();
            const startedAt = deps.db
              .select({ at: message.createdAt })
              .from(message)
              .where(eq(message.id, `github-feedback-start:${target.todo.teamId}`))
              .get()?.at;
            if (startedAt === undefined) continue;
            const baseline =
              Date.parse(pull.createdAt ?? '') > startedAt
                ? { comment: 0, 'review-comment': 0, review: 0 }
                : snapshot.highWater;
            if (cursor === undefined) {
              deps.db
                .insert(message)
                .values({
                  id: cursorId,
                  conversationId: target.build.id,
                  role: 'system',
                  content: { kind: 'github_feedback_baseline', ...baseline },
                  createdAt: nowMs(),
                })
                .onConflictDoNothing()
                .run();
            }
            const highWater = feedbackHighWaterSchema.parse(cursor?.content ?? baseline);
            for (const comment of snapshot.comments) {
              if (comment.id <= highWater[comment.kind]) continue;
              const id =
                `github-feedback:${target.todo.teamId}:${ref.owner}/${ref.repo}:${comment.key}`.toLowerCase();
              const dispatchedId = `dispatched:${id}`;
              if (
                deps.db
                  .select({ id: message.id })
                  .from(message)
                  .where(eq(message.id, dispatchedId))
                  .get()
              )
                continue;
              const permissionKey = `${access.token}:${`${ref.owner}/${ref.repo}:${comment.author}`.toLowerCase()}`;
              const cached = permissions.get(permissionKey);
              let allowed = cached && cached.expiresAt > nowMs() ? cached.allowed : undefined;
              if (allowed === undefined) {
                const permission = await githubCollaboratorPermission(
                  run.githubFetch,
                  access.token,
                  ref.owner,
                  ref.repo,
                  comment.author,
                );
                allowed =
                  permission !== null &&
                  (['write', 'admin', 'maintain'].includes(permission.permission) ||
                    ['write', 'admin', 'maintain'].includes(permission.roleName ?? ''));
                permissions.set(permissionKey, { allowed, expiresAt: nowMs() + 5 * 60_000 });
              }
              if (!allowed) continue;
              const content = `PR #${target.build.prNumber} feedback from ${comment.author}. Continue this Thread with the requested changes.\n\nGitHub feedback data:\n${neutralizeIssueAttachmentTokens(JSON.stringify(comment.body))}`;
              deps.db.transaction(() => {
                const current = deps.db
                  .select()
                  .from(todo)
                  .where(eq(todo.id, target.todo.id))
                  .get();
                if (
                  !current ||
                  current.latestBuildId !== target.build.id ||
                  current.archivedAt !== null ||
                  current.phase === 'closed'
                )
                  return;
                if (
                  deps.db
                    .select({ id: message.id })
                    .from(message)
                    .where(eq(message.id, dispatchedId))
                    .get()
                )
                  return;
                let active = deps.db
                  .select()
                  .from(step)
                  .where(
                    and(
                      eq(step.buildId, target.build.id),
                      inArray(step.status, ['pending', 'claimed', 'waiting_quota']),
                    ),
                  )
                  .all();
                if (
                  !deps.db.select({ id: message.id }).from(message).where(eq(message.id, id)).get()
                ) {
                  insertMessageRow(deps, target.build.id, {
                    id,
                    role: 'user',
                    content,
                    actor: comment.author,
                    createdAt: nowMs(),
                  });
                  delivered += 1;
                }
                if (
                  active.some(
                    (row) =>
                      row.status === 'claimed' && row.kind !== 'build' && row.kind !== 'plan',
                  )
                )
                  return;
                for (const row of active) {
                  if (row.kind === 'build' || row.kind === 'plan') continue;
                  const finishedAt = nowMs();
                  deps.db
                    .update(step)
                    .set({ status: 'stopped', finishedAt })
                    .where(eq(step.id, row.id))
                    .run();
                  publishStepRow(deps, { ...row, status: 'stopped', finishedAt });
                }
                active = active.filter((row) => row.kind === 'build' || row.kind === 'plan');
                const claimed = active.find((row) => row.status === 'claimed');
                if (claimed) {
                  const pending = deps.db
                    .select()
                    .from(steerPending)
                    .where(eq(steerPending.conversationId, target.build.id))
                    .get();
                  const steerContent =
                    pending?.stepId === claimed.id ? `${pending.content}\n\n${content}` : content;
                  deps.db
                    .insert(steerPending)
                    .values({
                      conversationId: target.build.id,
                      stepId: claimed.id,
                      content: steerContent,
                      createdAt: nowMs(),
                    })
                    .onConflictDoUpdate({
                      target: steerPending.conversationId,
                      set: { stepId: claimed.id, content: steerContent, createdAt: nowMs() },
                    })
                    .run();
                  deps.machineHub?.steerSignal(current.teamId, claimed.id);
                } else if (active.length === 0) {
                  deps.db
                    .update(build)
                    .set({ prevPhase: current.phase, errorMessage: null })
                    .where(eq(build.id, target.build.id))
                    .run();
                  setTodoPhase(
                    deps,
                    current.id,
                    current.phase === 'building' || current.phase === 'planning'
                      ? current.phase
                      : 'queued',
                    { lastRunAt: nowMs() },
                  );
                  enqueueStep(deps, target.build.id, 'build', current.teamId, content);
                } else {
                  for (const waiting of active) {
                    deps.db
                      .update(step)
                      .set({
                        prompt:
                          waiting.prompt === null ? content : `${waiting.prompt}\n\n${content}`,
                      })
                      .where(eq(step.id, waiting.id))
                      .run();
                  }
                  deps.machineHub?.wake(current.teamId);
                }
                deps.db
                  .insert(message)
                  .values({
                    id: dispatchedId,
                    conversationId: target.build.id,
                    role: 'system',
                    content: 'GitHub feedback delivered to the worker.',
                    createdAt: nowMs(),
                  })
                  .run();
              });
            }
          } catch (error) {
            run.logger?.info(
              {
                buildId: target.build.id,
                error: error instanceof Error ? error.message : String(error),
              },
              'PR feedback deferred',
            );
          }
        }
      } finally {
        sweeping = false;
      }
      return delivered;
    },
  };
}
