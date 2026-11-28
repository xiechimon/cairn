import {
  devinSweVariant,
  devinWireModelAtEffort,
  type TopModel,
  type TopModelsEnvelope,
  topModelsSchema,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { Db } from '../db/client.js';
import { teamTopModels } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';

type FavoriteStore = Pick<Db, 'select' | 'insert'>;

type StoredFavorites =
  | { state: 'absent' }
  | { state: 'invalid'; updatedAt: number }
  | { state: 'ok'; models: TopModel[]; updatedAt: number };

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

function storedFavorites(db: FavoriteStore, teamId: string, logger?: Logger): StoredFavorites {
  const row = db
    .select({ models: teamTopModels.models, updatedAt: teamTopModels.updatedAt })
    .from(teamTopModels)
    .where(eq(teamTopModels.teamId, teamId))
    .get();
  if (row === undefined) return { state: 'absent' };
  const models = parseStored(row.models);
  if (models === null) {
    logger?.warn({ teamId }, 'stored top models are invalid; serving none');
    return { state: 'invalid', updatedAt: row.updatedAt };
  }
  return { state: 'ok', models, updatedAt: row.updatedAt };
}

export function readTopModels(
  db: FavoriteStore,
  teamId: string,
  logger?: Logger,
): TopModelsEnvelope {
  const stored = storedFavorites(db, teamId, logger);
  return stored.state === 'ok'
    ? { models: stored.models.map(hydrated), updatedAt: stored.updatedAt }
    : { models: null, updatedAt: stored.state === 'invalid' ? stored.updatedAt : null };
}

export function writeTopModels(
  db: FavoriteStore,
  teamId: string,
  models: TopModel[],
): TopModelsEnvelope {
  const stored = storedFavorites(db, teamId);
  const previous = stored.state === 'ok' ? stored.models : [];
  const serialized = JSON.stringify(
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
            devinWireModelAtEffort(model.provider, model.modelId, model.thinkingLevel) ??
            model.modelId,
        }
      );
    }),
  );
  const previousVersion = stored.state === 'absent' ? 0 : stored.updatedAt;
  const updatedAt = Math.max(Date.now(), previousVersion + 1);
  db.insert(teamTopModels)
    .values({ teamId, models: serialized, updatedAt })
    .onConflictDoUpdate({ target: teamTopModels.teamId, set: { models: serialized, updatedAt } })
    .run();
  return { models, updatedAt };
}

export function favoriteModelOf(
  models: readonly TopModel[] | null,
  ref: { provider: string; modelId: string },
): TopModel | undefined {
  return (models ?? []).find(
    (model) => model.provider === ref.provider && model.modelId === ref.modelId,
  );
}

export function appendTopModel(
  db: FavoriteStore,
  teamId: string,
  model: TopModel,
): { added: boolean; models: TopModel[] } {
  const stored = storedFavorites(db, teamId);
  if (stored.state === 'invalid') {
    throw new HttpError(
      409,
      '常用模型列表在本机已损坏，聊天不会覆盖它。先在 设置 · 模型 里重新保存一次列表，再让我添加。',
    );
  }
  const current = stored.state === 'ok' ? stored.models.map(hydrated) : [];
  if (favoriteModelOf(current, model) !== undefined) return { added: false, models: current };
  const models = [...current, model];
  writeTopModels(db, teamId, models);
  return { added: true, models };
}
