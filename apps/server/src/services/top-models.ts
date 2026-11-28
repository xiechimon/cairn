import {
  devinSweVariant,
  devinWireModel,
  type TopModel,
  type TopModelsEnvelope,
  topModelsSchema,
} from '@cairn/shared';
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

function hydrated(model: TopModel): TopModel {
  const legacy = model.provider === 'devin' ? devinSweVariant(model.modelId) : null;
  return legacy === null
    ? model
    : { ...model, modelId: legacy.baseId, thinkingLevel: model.thinkingLevel ?? legacy.level };
}

function readStoredTopModels(db: Db, teamId: string, logger?: Logger): TopModelsEnvelope {
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

export function readTopModels(db: Db, teamId: string, logger?: Logger): TopModelsEnvelope {
  const { models } = readStoredTopModels(db, teamId, logger);
  return { models: models?.map(hydrated) ?? null };
}

export function writeTopModels(db: Db, teamId: string, models: TopModel[]): TopModelsEnvelope {
  const previous = readStoredTopModels(db, teamId).models ?? [];
  const stored = JSON.stringify(
    models.map((model) => {
      const old = previous.find((candidate) => {
        const view = hydrated(candidate);
        return (
          view.provider === 'devin' &&
          view.provider === model.provider &&
          view.modelId === model.modelId &&
          view.thinkingLevel === model.thinkingLevel
        );
      });
      return (
        old ?? {
          ...model,
          modelId:
            devinWireModel(model.provider, model.modelId, model.thinkingLevel) ?? model.modelId,
        }
      );
    }),
  );
  const updatedAt = Date.now();
  db.insert(teamTopModels)
    .values({ teamId, models: stored, updatedAt })
    .onConflictDoUpdate({ target: teamTopModels.teamId, set: { models: stored, updatedAt } })
    .run();
  return { models };
}
