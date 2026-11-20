import type {
  ActionTier,
  AutonomyRecord,
  PatchAutonomyBody,
  PatchTeamAutonomyBody,
  TeamAutonomy,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { project, team } from '../db/schema.js';
import { notFound } from '../lib/errors.js';

const DEFAULT_ACTION_TIER: ActionTier = 'full';

export function teamActionTierOf(db: Db, teamId: string): ActionTier {
  const row = db
    .select({ actionTier: team.actionTier })
    .from(team)
    .where(eq(team.id, teamId))
    .get();
  return row?.actionTier ?? DEFAULT_ACTION_TIER;
}

export function actionTierOf(db: Db, teamId: string, projectId: string | null): ActionTier {
  if (projectId !== null) {
    const row = db
      .select({ autonomy: project.autonomy, teamId: project.teamId })
      .from(project)
      .where(eq(project.id, projectId))
      .get();
    if (row !== undefined && row.teamId === teamId && row.autonomy?.actionTier != null) {
      return row.autonomy.actionTier;
    }
  }
  return teamActionTierOf(db, teamId);
}

export function readAutonomy(db: Db, projectId: string): AutonomyRecord {
  const row = db
    .select({ autonomy: project.autonomy, teamId: project.teamId })
    .from(project)
    .where(eq(project.id, projectId))
    .get();
  if (row === undefined) throw notFound('project');
  return {
    actionTier: row.autonomy?.actionTier ?? teamActionTierOf(db, row.teamId),
    actionTierOverride: row.autonomy?.actionTier ?? null,
  };
}

export function patchAutonomy(db: Db, projectId: string, body: PatchAutonomyBody): AutonomyRecord {
  const row = db
    .select({ autonomy: project.autonomy })
    .from(project)
    .where(eq(project.id, projectId))
    .get();
  if (row === undefined) throw notFound('project');
  const next = { ...(row.autonomy ?? {}), ...body };
  db.update(project).set({ autonomy: next }).where(eq(project.id, projectId)).run();
  return readAutonomy(db, projectId);
}

export function readTeamAutonomy(db: Db, teamId: string): TeamAutonomy {
  return { actionTier: teamActionTierOf(db, teamId) };
}

export function patchTeamAutonomy(
  db: Db,
  teamId: string,
  body: PatchTeamAutonomyBody,
): TeamAutonomy {
  if (body.actionTier !== undefined) {
    db.update(team).set({ actionTier: body.actionTier }).where(eq(team.id, teamId)).run();
  }
  return readTeamAutonomy(db, teamId);
}
