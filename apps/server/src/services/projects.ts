import {
  DEFAULT_AUTONOMY_SETTINGS,
  type PatchProjectBody,
  type ProjectMergeConfig,
  patchProjectMergeConfigSchema,
  projectConvertedNote,
  projectGithubRepoRetargetedNote,
  projectMergeConfigSchema,
  projectRenamedNote,
  type SecretBox,
} from '@cairn/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { agentMemory, build, chief, project, schedule, step, tag, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import type { FetchLike } from '../lib/github.js';
import { githubRepoReachable } from '../lib/github.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import type { ConversationStreamHub } from './events.js';
import { isGithubRepoRef, removeHostedRepoDir, validateGithubLocalSlotPath } from './git.js';
import { openGithubToken } from './github-connection.js';
import { insertMessageRow } from './transcript.js';

type ProjectRow = typeof project.$inferSelect;

export function projectMergeConfigOf(row: ProjectRow): ProjectMergeConfig {
  const raw = row.autonomy as (typeof row.autonomy & Partial<ProjectMergeConfig>) | null;
  return projectMergeConfigSchema.parse({
    mergePolicy: raw?.mergePolicy,
    localChecks: raw?.localChecks,
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

export interface ProjectDeps {
  db: Db;
  reposDir: string;
}

export interface ProjectPatchDeps {
  db: Db;
  box: SecretBox;
  githubFetch?: FetchLike;
  convHub?: ConversationStreamHub;
  logger?: { info(obj: object, msg: string): void };
}

const IN_FLIGHT_STEP_STATUSES = ['pending', 'claimed', 'waiting_quota'] as const;

export function deleteProject(deps: ProjectDeps, id: string): boolean {
  const { db } = deps;
  const row = db.select().from(project).where(eq(project.id, id)).get();
  if (!row) return false;
  const todoIds = db
    .select({ id: todo.id })
    .from(todo)
    .where(eq(todo.projectId, id))
    .all()
    .map((r) => r.id);
  const buildIds =
    todoIds.length > 0
      ? db
          .select({ id: build.id })
          .from(build)
          .where(inArray(build.todoId, todoIds))
          .all()
          .map((r) => r.id)
      : [];
  db.transaction((tx) => {
    if (buildIds.length > 0) tx.delete(step).where(inArray(step.buildId, buildIds)).run();
    tx.delete(schedule).where(eq(schedule.projectId, id)).run();
    tx.delete(tag).where(eq(tag.projectId, id)).run();
    if (todoIds.length > 0) tx.delete(todo).where(inArray(todo.id, todoIds)).run();
    for (const chiefRow of tx.select().from(chief).where(eq(chief.teamId, row.teamId)).all()) {
      const next = chiefRow.watches.filter((w) => !todoIds.includes(w.todoId));
      if (next.length !== chiefRow.watches.length) {
        tx.update(chief).set({ watches: next }).where(eq(chief.id, chiefRow.id)).run();
      }
    }
    tx.update(agentMemory).set({ projectId: null }).where(eq(agentMemory.projectId, id)).run();
    tx.delete(project).where(eq(project.id, id)).run();
  });
  if (row.repoKind === 'hosted' && row.repoName !== null) {
    removeHostedRepoDir(deps.reposDir, row.teamId, row.repoName);
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
    body.description !== undefined ||
    body.repoKind !== undefined ||
    body.githubRepo !== undefined ||
    body.localPath !== undefined;
  if (!carriesKey) {
    throw new HttpError(
      400,
      'invalid body: nothing to update (at least one of name/description/repoKind/githubRepo/localPath)',
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
    const token = openGithubToken({ db, box: deps.box }, row.teamId);
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
  const nextRepoKind = conversion !== undefined ? 'github' : row.repoKind;
  const nextGithubRepo = conversion?.githubRepo ?? retarget?.githubRepo ?? row.githubRepo;
  const nextLocalPath = localPath !== undefined ? localPath : row.localPath;
  const nextDescription = description !== undefined ? description : row.description;
  db.update(project)
    .set({
      name: nextName,
      repoKind: nextRepoKind,
      githubRepo: nextGithubRepo,
      localPath: nextLocalPath,
      description: nextDescription,
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
    .where(and(inArray(step.buildId, buildIds), inArray(step.status, [...IN_FLIGHT_STEP_STATUSES])))
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
