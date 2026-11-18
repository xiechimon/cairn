import { and, eq, gte, lt, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { autonomousMergeAdmission, build, message, project, team, todo } from '../db/schema.js';
import { conflict } from '../lib/errors.js';
import { type FetchLike, githubPull } from '../lib/github.js';
import { nowMs } from '../lib/ids.js';
import type { BuildDeps } from './builds.js';
import { githubRepoOfProject } from './git.js';
import { teamAutonomyPaused } from './github-autonomy-brake.js';
import { userTokenOrNull } from './github-connection.js';

type Store = Pick<Db, 'select' | 'insert' | 'update' | 'delete'>;
const KIND = 'autonomous-merge-admission';

export function autonomousMergePolicy(
  db: Store,
  teamId: string,
  now = nowMs(),
  excludeBuildId?: string,
): { autonomyPaused: boolean; dailyCapReached: boolean } {
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
  const count = admissions.filter((row) => row.buildId !== excludeBuildId).length;
  const teamRow = db.select().from(team).where(eq(team.id, teamId)).get();
  return {
    autonomyPaused: teamRow === undefined || teamAutonomyPaused(db, teamId),
    dailyCapReached: count >= (teamRow?.maxAutonomousMergesPerDay ?? 0),
  };
}

export function claimAutonomousMerge(db: Db, buildId: string, explicit = false): void {
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
      const brake = explicit
        ? { autonomyPaused: false, dailyCapReached: false }
        : autonomousMergePolicy(tx, context.todo.teamId);
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
    if (admission?.state === 'merged') return;
    if (!admission && outcome === 'refused') return;
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
    const context = tx
      .select({ todo, project })
      .from(build)
      .innerJoin(todo, eq(build.todoId, todo.id))
      .innerJoin(project, eq(todo.projectId, project.id))
      .where(eq(build.id, buildId))
      .get();
    if (!admission && !context) return;
    const teamId = admission?.teamId ?? context?.todo.teamId;
    if (!teamId) return;
    tx.insert(autonomousMergeAdmission)
      .values({
        buildId,
        teamId,
        state: 'merged',
        createdAt: admission?.createdAt ?? landedAt,
        landedAt,
      })
      .onConflictDoUpdate({
        target: autonomousMergeAdmission.buildId,
        set: { state: 'merged', landedAt },
      })
      .run();
    const content = JSON.stringify({ kind: KIND, teamId, state: 'merged', landedAt });
    tx.insert(message)
      .values({ id, conversationId: buildId, role: 'system', content, createdAt: landedAt })
      .onConflictDoUpdate({ target: message.id, set: { content } })
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
        lt(autonomousMergeAdmission.createdAt, now - Math.max(windowMs, 60_000)),
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
      if (!context) continue;
      const target = githubRepoOfProject(context.project);
      if (target && context.build.prNumber !== null) {
        const token = await userTokenOrNull(deps, admission.teamId);
        const page = await githubPull(
          githubFetch,
          token,
          target.owner,
          target.repo,
          context.build.prNumber,
        );
        if (page?.pull && !page.pull.merged) {
          settleAutonomousMerge(deps.db, admission.buildId, 'refused');
        }
      }
    } catch {}
  }
}
