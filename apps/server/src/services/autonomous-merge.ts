import type { ProjectMergeConfig } from '@cairn/shared';
import { and, desc, eq, gte, isNull, lt, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  autonomousMergeAdmission,
  build,
  message,
  project,
  step,
  team,
  todo,
} from '../db/schema.js';
import { conflict } from '../lib/errors.js';
import { type FetchLike, githubPull } from '../lib/github.js';
import { nowMs } from '../lib/ids.js';
import type { BuildDeps } from './builds.js';
import { githubRepoOfProject } from './git.js';
import { githubTokenOrNull } from './github-connection.js';
import { projectMergeConfigOf } from './projects.js';

type Store = Pick<Db, 'select' | 'insert' | 'update' | 'delete'>;
const KIND = 'autonomous-merge-admission';

export function autonomousMergePolicy(
  db: Store,
  teamId: string,
  config: ProjectMergeConfig,
  now = nowMs(),
  excludeBuildId?: string,
): { autonomyPaused: boolean; dailyCapReached: boolean } {
  if (config.mergePolicy !== 'autonomous') return { autonomyPaused: false, dailyCapReached: false };
  const start = Date.parse(`${new Date(now).toISOString().slice(0, 10)}T00:00:00Z`);
  const end = start + 86_400_000;
  const admissions = db
    .select()
    .from(autonomousMergeAdmission)
    .where(
      and(
        eq(autonomousMergeAdmission.teamId, teamId),
        or(
          eq(autonomousMergeAdmission.state, 'pending'),
          and(
            gte(autonomousMergeAdmission.landedAt, start),
            lt(autonomousMergeAdmission.landedAt, end),
          ),
        ),
      ),
    )
    .all();
  let count = admissions.filter((row) => row.buildId !== excludeBuildId).length;
  const recorded = new Set(admissions.map((row) => row.buildId));
  const all = db
    .select({ message, project })
    .from(message)
    .leftJoin(
      autonomousMergeAdmission,
      eq(message.conversationId, autonomousMergeAdmission.buildId),
    )
    .innerJoin(build, eq(message.conversationId, build.id))
    .innerJoin(todo, eq(build.todoId, todo.id))
    .innerJoin(project, eq(todo.projectId, project.id))
    .where(
      and(
        eq(todo.teamId, teamId),
        eq(message.role, 'system'),
        isNull(autonomousMergeAdmission.buildId),
        gte(message.createdAt, start),
        lt(message.createdAt, end),
      ),
    )
    .all();
  const localRecorded = new Set<string>();
  for (const { message: row, project: projectRow } of all) {
    if (
      projectMergeConfigOf(projectRow).mergePolicy !== 'autonomous' ||
      recorded.has(row.conversationId) ||
      row.createdAt < start ||
      row.createdAt >= end
    )
      continue;
    let raw = row.content;
    if (typeof raw === 'string') {
      if (/^PR #\d+ 已由 cairn 经 GitHub 合并/.test(raw)) {
        count++;
        continue;
      }
      try {
        raw = JSON.parse(raw) as unknown;
      } catch {
        continue;
      }
    }
    if (raw === null || typeof raw !== 'object') continue;
    const result = raw as { kind?: unknown; result?: { outcome?: unknown } };
    if (result.kind === 'local-merge-result' && result.result?.outcome === 'merged') {
      count++;
      localRecorded.add(row.conversationId);
    }
  }
  const legacySteps = db
    .select({ step, project })
    .from(step)
    .leftJoin(autonomousMergeAdmission, eq(step.buildId, autonomousMergeAdmission.buildId))
    .innerJoin(build, eq(step.buildId, build.id))
    .innerJoin(todo, eq(build.todoId, todo.id))
    .innerJoin(project, eq(todo.projectId, project.id))
    .where(
      and(
        eq(todo.teamId, teamId),
        eq(step.kind, 'merge'),
        eq(step.status, 'done'),
        isNull(autonomousMergeAdmission.buildId),
        gte(step.finishedAt, start),
        lt(step.finishedAt, end),
      ),
    )
    .all();
  for (const { step: row, project: projectRow } of legacySteps) {
    if (
      projectMergeConfigOf(projectRow).mergePolicy === 'autonomous' &&
      !recorded.has(row.buildId) &&
      !localRecorded.has(row.buildId) &&
      row.checkpointCommit !== null &&
      row.prompt?.includes('"local-merge"')
    )
      count++;
  }
  const teamRow = db.select().from(team).where(eq(team.id, teamId)).get();
  return {
    autonomyPaused: teamRow?.autonomyPaused !== false,
    dailyCapReached: count >= (teamRow?.maxAutonomousMergesPerDay ?? 0),
  };
}

export function claimAutonomousMerge(db: Db, buildId: string): void {
  db.transaction(
    (tx) => {
      const context = tx
        .select({ todo, project })
        .from(build)
        .innerJoin(todo, eq(build.todoId, todo.id))
        .innerJoin(project, eq(todo.projectId, project.id))
        .where(eq(build.id, buildId))
        .get();
      if (!context) throw conflict('Merge context is missing');
      const config = projectMergeConfigOf(context.project);
      if (config.mergePolicy !== 'autonomous') return;
      const brake = autonomousMergePolicy(tx, context.todo.teamId, config);
      if (brake.autonomyPaused) throw conflict('autonomy-paused: autonomous merging is paused');
      const id = `autonomous-merge-${buildId}`;
      if (
        tx
          .select()
          .from(autonomousMergeAdmission)
          .where(eq(autonomousMergeAdmission.buildId, buildId))
          .get()
      )
        throw conflict('Autonomous merge already admitted; reconcile the previous result');
      if (brake.dailyCapReached) throw conflict('daily-cap: autonomous merge limit reached');
      tx.insert(autonomousMergeAdmission)
        .values({
          buildId,
          teamId: context.todo.teamId,
          state: 'pending',
          createdAt: nowMs(),
          landedAt: null,
        })
        .run();
      tx.insert(message)
        .values({
          id,
          conversationId: buildId,
          role: 'system',
          content: JSON.stringify({
            kind: KIND,
            teamId: context.todo.teamId,
            state: 'pending',
            landedAt: null,
          }),
          createdAt: nowMs(),
        })
        .run();
    },
    { behavior: 'immediate' },
  );
}

export function settleAutonomousMerge(
  db: Db,
  buildId: string,
  outcome: 'merged' | 'refused',
  landedAt = nowMs(),
): void {
  db.transaction((tx) => {
    const admission = tx
      .select()
      .from(autonomousMergeAdmission)
      .where(eq(autonomousMergeAdmission.buildId, buildId))
      .get();
    if (!admission || admission.state === 'merged') return;
    const id = `autonomous-merge-${buildId}`;
    if (outcome === 'refused') {
      tx.delete(autonomousMergeAdmission)
        .where(eq(autonomousMergeAdmission.buildId, buildId))
        .run();
      tx.delete(message)
        .where(and(eq(message.id, id), eq(message.role, 'system')))
        .run();
      return;
    }
    tx.update(autonomousMergeAdmission)
      .set({ state: 'merged', landedAt })
      .where(eq(autonomousMergeAdmission.buildId, buildId))
      .run();
    tx.update(message)
      .set({
        content: JSON.stringify({
          kind: KIND,
          teamId: admission.teamId,
          state: 'merged',
          landedAt,
        }),
      })
      .where(eq(message.id, id))
      .run();
  });
}

export async function recoverAutonomousMerges(
  deps: BuildDeps,
  githubFetch: FetchLike,
  now: number,
  windowMs: number,
): Promise<void> {
  const pending = deps.db
    .select()
    .from(autonomousMergeAdmission)
    .where(
      and(
        eq(autonomousMergeAdmission.state, 'pending'),
        lt(autonomousMergeAdmission.createdAt, now - windowMs),
      ),
    )
    .all();
  for (const admission of pending) {
    try {
      const context = deps.db
        .select({ build, project })
        .from(build)
        .innerJoin(todo, eq(build.todoId, todo.id))
        .innerJoin(project, eq(todo.projectId, project.id))
        .where(eq(build.id, admission.buildId))
        .get();
      if (!context) {
        settleAutonomousMerge(deps.db, admission.buildId, 'refused');
        continue;
      }
      const target = githubRepoOfProject(context.project);
      if (target && context.build.prNumber !== null) {
        const token = await githubTokenOrNull(deps, admission.teamId);
        const page = await githubPull(
          githubFetch,
          token,
          target.owner,
          target.repo,
          context.build.prNumber,
        );
        if (page?.pull) {
          const mergedAt = page.pull.mergedAt === null ? NaN : Date.parse(page.pull.mergedAt);
          settleAutonomousMerge(
            deps.db,
            admission.buildId,
            page.pull.merged ? 'merged' : 'refused',
            Number.isFinite(mergedAt) ? mergedAt : now,
          );
        }
        continue;
      }
      if (context.project.repoKind !== 'local') continue;
      const command = deps.db
        .select()
        .from(step)
        .where(
          and(
            eq(step.buildId, admission.buildId),
            eq(step.kind, 'merge'),
            gte(step.createdAt, admission.createdAt),
          ),
        )
        .orderBy(desc(step.createdAt))
        .get();
      if (
        !command ||
        command.status === 'failed' ||
        command.status === 'stopped' ||
        command.status === 'done'
      ) {
        settleAutonomousMerge(
          deps.db,
          admission.buildId,
          command?.status === 'done' && command.checkpointCommit !== null ? 'merged' : 'refused',
          command?.finishedAt ?? now,
        );
      }
    } catch {}
  }
}
