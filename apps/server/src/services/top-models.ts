import { type TopModel, type TopModelsEnvelope, topModelsSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { Db } from '../db/client.js';
import { teamTopModels } from '../db/schema.js';

function parseStored(raw: string): TopModel[] | null {
  try {
    const parsed = topModelsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function readTopModels(db: Db, teamId: string, logger?: Logger): TopModelsEnvelope {
  const row = db
    .select({ models: teamTopModels.models })
    .from(teamTopModels)
    .where(eq(teamTopModels.teamId, teamId))
    .get();
  if (row === undefined) return { models: null };
  const models = parseStored(row.models);
  if (models === null) logger?.warn({ teamId }, 'stored top models are invalid; serving none');
  return { models };
}

export function writeTopModels(db: Db, teamId: string, models: TopModel[]): TopModelsEnvelope {
  const stored = JSON.stringify(models);
  const updatedAt = Date.now();
  db.insert(teamTopModels)
    .values({ teamId, models: stored, updatedAt })
    .onConflictDoUpdate({ target: teamTopModels.teamId, set: { models: stored, updatedAt } })
    .run();
  return { models };
}
