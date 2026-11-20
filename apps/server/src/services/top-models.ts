import { type TopModel, type TopModelsEnvelope, topModelsSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { Db } from '../db/client.js';
import { teamTopModels } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';

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

export function frequentModelFor(db: Db, teamId: string, named: string): TopModel {
  const models = readTopModels(db, teamId).models ?? [];
  const matches = models.filter(
    (m) => m.modelId === named || `${m.provider}/${m.modelId}` === named,
  );
  const [only] = matches;
  if (matches.length === 1 && only !== undefined) return only;
  if (models.length === 0) {
    throw new HttpError(
      400,
      `model ${named} refused: the owner has no frequently used models. Omit model; the task runs on the team task model. If it must run on this model, ask the owner to add it in Settings > Model.`,
    );
  }
  const listed = models.map((m) => `${m.provider}/${m.modelId}`).join(', ');
  throw new HttpError(
    400,
    matches.length > 1
      ? `model ${named} is ambiguous; pass provider/modelId, one of: ${listed}`
      : `model ${named} is not one of the owner's frequently used models: ${listed}. Pick one of them or omit model. If it must run on ${named}, ask the owner to add it in Settings > Model — do not try to add it yourself.`,
  );
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
