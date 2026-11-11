import {
  ACTIVE_STEP_STATUSES,
  DEFAULT_AUTONOMY_SETTINGS,
  DEFAULT_SHIP_ROUTE,
  type PatchProjectBody,
  type ProjectMergeConfig,
  patchProjectMergeConfigSchema,
  projectConvertedNote,
  projectGithubRepoRetargetedNote,
  projectMergeConfigSchema,
  projectRenamedNote,
  type SecretBox,
  type ShipRoute,
  shipRouteSchema,
} from '@cairn/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  build,
  chief,
  chiefThread,
  project,
  schedule,
  secret,
  step,
  stopPending,
  tag,
  todo,
} from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import type { FetchLike } from '../lib/github.js';
import { githubRepoReachable } from '../lib/github.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import type { ConversationStreamHub } from './events.js';
import { isGithubRepoRef, removeHostedRepoDir, validateGithubLocalSlotPath } from './git.js';
import { githubReadToken } from './github-autonomous-token.js';
import { moveProjectMemoriesToTeam } from './memory.js';
import type { OAuthClientConfig } from './oauth.js';
import { insertMessageRow } from './transcript.js';

type ProjectRow = typeof project.$inferSelect;

export function projectMergeConfigOf(row: ProjectRow): ProjectMergeConfig {
  const raw = row.autonomy as (typeof row.autonomy & Partial<ProjectMergeConfig>) | null;
  return projectMergeConfigSchema.parse({
    planAutoApproveEnabled: raw?.planAutoApproveEnabled,
    mergePolicy: raw?.mergePolicy,
    localChecks: raw?.localChecks,
    requireUpToDate: raw?.requireUpToDate,
  });
}

export function updateProjectMergeConfig(
  db: Db,
  row: ProjectRow,
  input: unknown,
): ProjectMergeConfig {
  const patch = patchProjectMergeConfigSchema.parse(input);
  const current = projectMergeConfigOf(row);
  const next = projectMergeConfigSchema.parse({ ...current, ...patch });
  const autonomy = { ...DEFAULT_AUTONOMY_SETTINGS, ...(row.autonomy ?? {}), ...next };
  db.update(project).set({ autonomy }).where(eq(project.id, row.id)).run();
  return next;
}

export function projectShipRouteOf(row: ProjectRow): ShipRoute {
  return shipRouteSchema.catch(DEFAULT_SHIP_ROUTE).parse(row.autonomy?.shipRoute);
}

export function updateProjectShipRoute(db: Db, row: ProjectRow, shipRoute: ShipRoute): ShipRoute {
  if (shipRoute === 'local-merge' && row.repoKind !== 'local') {
    throw new HttpError(409, 'local-merge requires a local repository project');
  }
  const autonomy = { ...DEFAULT_AUTONOMY_SETTINGS, ...(row.autonomy ?? {}), shipRoute };
  db.update(project).set({ autonomy }).where(eq(project.id, row.id)).run();
  return shipRoute;
}

export interface ProjectDeps {
  db: Db;
  reposDir: string;
}

export interface ProjectPatchDeps {
  db: Db;
  box: SecretBox;
  githubFetch?: FetchLike;
  oauthClient?: OAuthClientConfig | null;
  convHub?: ConversationStreamHub;
  logger?: { info(obj: object, msg: string): void };
}

export function setProjectArchived(
  db: Db,
  id: string,
  archived: boolean,
): typeof project.$inferSelect | undefined {
  const row = db.select().from(project).where(eq(project.id, id)).get();
  if (row === undefined || (row.archivedAt !== null) === archived) return row;
  const archivedAt = archived ? nowMs() : null;
  db.update(project).set({ archivedAt }).where(eq(project.id, id)).run();
  return { ...row, archivedAt };
}

type ProjectReader = Pick<Db, 'all'>;

function projectRunningWork(db: ProjectReader, projectId: string): string[] {
  const rows = db.all<{ line: string }>(sql`
    with project_steps as (
      select step.* from step
      left join build on build.id = step.buildId
      left join todo on todo.id = build.todoId
      left join chief_thread on chief_thread.id = step.buildId
      where todo.projectId = ${projectId} or step.scopeProjectId = ${projectId}
        or chief_thread.projectId = ${projectId}
    )
    select line from (
      select 'step ' || step.id || ' ' || step.status || ' on build ' || step.buildId as line,
        1 as kind, step.id as sortKey
      from project_steps as step
      where step.status in (${sql.join(
        ACTIVE_STEP_STATUSES.map((status) => sql`${status}`),
        sql`, `,
      )})
      union all
      select 'branch-sync ' || branch_sync.id || ' ' || branch_sync.status || ' on build ' || branch_sync.buildId,
        2, branch_sync.id
      from branch_sync
      inner join build on build.id = branch_sync.buildId
      inner join todo on todo.id = build.todoId
      where todo.projectId = ${projectId} and branch_sync.status in ('pending', 'running')
      union all
      select 'chief-thread ' || id, 3, id
      from chief_thread
      where projectId = ${projectId} and activeRun is not null
      union all
      select 'computer-call ' || computer_call.id || ' ' || computer_call.state || ' on step ' || computer_call.stepId,
        4, computer_call.id
      from computer_call
      inner join project_steps as step on step.id = computer_call.stepId
      where computer_call.state in ('dispatched', 'running')
      union all
      select 'computer ' || computer.id || ' ' || computer.state || ' on step ' || computer.executionStepId,
        5, computer.id
      from computer
      inner join project_steps as step on step.id = computer.executionStepId
      where computer.state in ('starting', 'running')
      union all
      select 'autonomous-merge ' || autonomous_merge_admission.buildId || ' pending',
        6, autonomous_merge_admission.buildId
      from autonomous_merge_admission
      inner join build on build.id = autonomous_merge_admission.buildId
      inner join todo on todo.id = build.todoId
      where todo.projectId = ${projectId} and autonomous_merge_admission.state = 'pending'
    )
    order by kind, sortKey
  `);
  return rows.map((row) => row.line);
}

export function deleteProject(deps: ProjectDeps, id: string): boolean {
  const removed = deps.db.transaction(
    (tx) => {
      const row = tx.select().from(project).where(eq(project.id, id)).get();
      if (!row) return null;
      const running = projectRunningWork(tx, id);
      if (running.length > 0) {
        throw new HttpError(
          409,
          `cannot delete project while work is running: ${running.join('; ')}`,
          'project-running',
        );
      }
      const todoIds = tx
        .select({ id: todo.id })
        .from(todo)
        .where(eq(todo.projectId, id))
        .all()
        .map((r) => r.id);
      const buildIds =
        todoIds.length > 0
          ? tx
              .select({ id: build.id })
              .from(build)
              .where(inArray(build.todoId, todoIds))
              .all()
              .map((r) => r.id)
          : [];
      if (buildIds.length > 0) {
        tx.delete(stopPending).where(inArray(stopPending.conversationId, buildIds)).run();
        tx.delete(step).where(inArray(step.buildId, buildIds)).run();
      }
      tx.delete(schedule).where(eq(schedule.projectId, id)).run();
      tx.delete(tag).where(eq(tag.projectId, id)).run();
      tx.delete(secret).where(eq(secret.projectId, id)).run();
      if (todoIds.length > 0) tx.delete(todo).where(inArray(todo.id, todoIds)).run();
      for (const chiefRow of tx.select().from(chief).where(eq(chief.teamId, row.teamId)).all()) {
        const next = chiefRow.watches.filter((w) => !todoIds.includes(w.todoId));
        if (next.length !== chiefRow.watches.length) {
          tx.update(chief).set({ watches: next }).where(eq(chief.id, chiefRow.id)).run();
        }
      }
      moveProjectMemoriesToTeam(tx, id);
      tx.update(chiefThread).set({ projectId: null }).where(eq(chiefThread.projectId, id)).run();
      tx.delete(project).where(eq(project.id, id)).run();
      return row;
    },
    { behavior: 'immediate' },
  );
  if (removed === null) return false;
  if (removed.repoKind === 'hosted' && removed.repoName !== null) {
    removeHostedRepoDir(deps.reposDir, removed.teamId, removed.repoName);
  }
  return true;
}

interface ConversionInput {
  githubRepo: string;
  localPath: string | null | undefined;
}

interface RetargetInput {
  githubRepo: string;
}

export async function updateProject(
  deps: ProjectPatchDeps,
  id: string,
  body: PatchProjectBody,
): Promise<ProjectRow | null> {
  const { db } = deps;
  const row = db.select().from(project).where(eq(project.id, id)).get();
  if (row === undefined) return null;

  const carriesKey =
    body.name !== undefined ||
    body.group !== undefined ||
    body.splitPolicy !== undefined ||
    body.evidenceStore !== undefined ||
    body.description !== undefined ||
    body.instructions !== undefined ||
    body.maxConcurrent !== undefined ||
    body.repoKind !== undefined ||
    body.githubRepo !== undefined ||
    body.localPath !== undefined ||
    body.baseBranch !== undefined ||
    body.icon !== undefined ||
    body.color !== undefined;
  if (!carriesKey) {
    throw new HttpError(
      400,
      'invalid body: nothing to update (at least one of group/name/splitPolicy/evidenceStore/description/instructions/maxConcurrent/repoKind/githubRepo/localPath/baseBranch/icon/color)',
    );
  }

  const name = body.name !== undefined ? body.name.trim() : undefined;
  if (name !== undefined && name === '') {
    throw new HttpError(400, 'invalid body at name: required non-empty');
  }

  let conversion: ConversionInput | undefined;
  let retarget: RetargetInput | undefined;
  if (body.repoKind !== undefined) {
    if (body.repoKind !== 'github') {
      throw new HttpError(
        400,
        `invalid body at repoKind: kind conversion only supports local→github, got "${body.repoKind}"`,
      );
    }
    if (row.repoKind === 'github') {
      throw new HttpError(400, 'invalid body at repoKind: project is already github');
    }
    if (row.repoKind !== 'local') {
      throw new HttpError(
        400,
        `invalid body at repoKind: kind conversion only supports local→github, got "${row.repoKind ?? 'plain'}" project`,
      );
    }
    if (body.githubRepo === undefined || !isGithubRepoRef(body.githubRepo)) {
      throw new HttpError(
        400,
        'invalid body at githubRepo: expected "owner/repo" for kind conversion',
      );
    }
    conversion = { githubRepo: body.githubRepo, localPath: body.localPath };
  } else if (body.githubRepo !== undefined) {
    if (row.repoKind !== 'github') {
      throw new HttpError(
        400,
        'invalid body at githubRepo: only changeable via local→github kind conversion (carry repoKind)',
      );
    }
    if (!isGithubRepoRef(body.githubRepo)) {
      throw new HttpError(400, 'invalid body at githubRepo: expected "owner/repo"');
    }
    if (body.githubRepo !== row.githubRepo) {
      retarget = { githubRepo: body.githubRepo };
    }
  }

  let localPath: string | null | undefined;
  if (conversion !== undefined) {
    localPath =
      conversion.localPath === undefined
        ? row.localPath
        : validateGithubLocalSlotPath(conversion.localPath);
  } else if (body.localPath !== undefined) {
    if (row.repoKind !== 'github') {
      throw new HttpError(
        400,
        'invalid body at localPath: localPath acceleration slot only applies to github projects',
      );
    }
    localPath = validateGithubLocalSlotPath(body.localPath);
  }

  if (conversion !== undefined) {
    await assertNoInFlightBuilds(db, id);
  }
  if (conversion !== undefined || retarget !== undefined) {
    const ref = conversion?.githubRepo ?? retarget?.githubRepo ?? '';
    const slash = ref.indexOf('/');
    const owner = ref.slice(0, slash);
    const repo = ref.slice(slash + 1);
    const token = await githubReadToken(deps, row.teamId, { owner, repo });
    const fetchImpl = deps.githubFetch ?? fetch;
    const probe = await githubRepoReachable(fetchImpl, token, owner, repo);
    if (!probe.reachable) {
      throw new HttpError(400, `invalid body at githubRepo: repository not reachable: ${ref}`);
    }
    if (
      retarget !== undefined &&
      probe.fullName !== null &&
      probe.fullName.toLowerCase() !== ref.toLowerCase()
    ) {
      deps.logger?.info(
        { projectId: id, from: ref, to: probe.fullName },
        `github repo renamed: ${ref} now answers as ${probe.fullName}; consider updating the project`,
      );
    }
  }

  const description =
    body.description !== undefined
      ? body.description !== null && body.description.trim() !== ''
        ? body.description
        : null
      : undefined;

  const nextName = name ?? row.name;
  const nextSplitPolicy = body.splitPolicy ?? row.splitPolicy;
  const nextRepoKind = conversion !== undefined ? 'github' : row.repoKind;
  const nextGithubRepo = conversion?.githubRepo ?? retarget?.githubRepo ?? row.githubRepo;
  const nextLocalPath = localPath !== undefined ? localPath : row.localPath;
  const nextDescription = description !== undefined ? description : row.description;
  db.update(project)
    .set({
      name: nextName,
      group: body.group !== undefined ? body.group : row.group,
      splitPolicy: nextSplitPolicy,
      evidenceStore: body.evidenceStore ?? row.evidenceStore,
      repoKind: nextRepoKind,
      githubRepo: nextGithubRepo,
      localPath: nextLocalPath,
      description: nextDescription,
      instructions:
        body.instructions === undefined
          ? row.instructions
          : body.instructions === null || body.instructions.trim() === ''
            ? null
            : body.instructions,
      maxConcurrent: body.maxConcurrent !== undefined ? body.maxConcurrent : row.maxConcurrent,
      baseBranch: body.baseBranch !== undefined ? body.baseBranch : row.baseBranch,
      icon: body.icon !== undefined ? body.icon : row.icon,
      color: body.color !== undefined ? body.color : row.color,
    })
    .where(eq(project.id, id))
    .run();

  const renamed = name !== undefined && name !== row.name;
  if (conversion !== undefined) {
    insertProjectNote(
      deps,
      id,
      projectConvertedNote({ githubRepo: conversion.githubRepo, localPath: nextLocalPath }),
    );
  } else {
    if (retarget !== undefined) {
      insertProjectNote(
        deps,
        id,
        projectGithubRepoRetargetedNote({
          from: row.githubRepo ?? '',
          to: retarget.githubRepo,
        }),
      );
    }
    if (renamed) {
      insertProjectNote(deps, id, projectRenamedNote({ from: row.name, to: nextName }));
    }
  }

  const updated = db.select().from(project).where(eq(project.id, id)).get();
  if (updated === undefined) throw new Error(`project ${id} missing after update`);
  return updated;
}

async function assertNoInFlightBuilds(db: Db, projectId: string): Promise<void> {
  const todoIds = db
    .select({ id: todo.id })
    .from(todo)
    .where(eq(todo.projectId, projectId))
    .all()
    .map((r) => r.id);
  if (todoIds.length === 0) return;
  const buildIds = db
    .select({ id: build.id })
    .from(build)
    .where(inArray(build.todoId, todoIds))
    .all()
    .map((r) => r.id);
  if (buildIds.length === 0) return;
  const inflight = db
    .select({ buildId: step.buildId })
    .from(step)
    .where(and(inArray(step.buildId, buildIds), inArray(step.status, [...ACTIVE_STEP_STATUSES])))
    .all();
  if (inflight.length > 0) {
    throw new HttpError(
      409,
      `kind conversion blocked: project has in-flight builds (${inflight.length} active step${inflight.length > 1 ? 's' : ''}); wait for runs to finish or stop them first`,
    );
  }
}

function insertProjectNote(deps: ProjectPatchDeps, projectId: string, content: string): void {
  const rows = deps.db
    .select({ latestBuildId: todo.latestBuildId })
    .from(todo)
    .where(eq(todo.projectId, projectId))
    .all();
  const conversationIds = rows.map((r) => r.latestBuildId).filter((v): v is string => v !== null);
  for (const conversationId of conversationIds) {
    insertMessageRow(deps, conversationId, {
      id: newRecordId(),
      role: 'system',
      content,
      createdAt: nowMs(),
    });
  }
}
