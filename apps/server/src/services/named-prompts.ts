import {
  DEFAULT_NAMED_PROMPTS,
  NAMED_PROMPT_IDS,
  type NamedPromptId,
  type NamedPromptOverrides,
  type NamedPromptRecord,
  namedPromptOverridesSchema,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { team } from '../db/schema.js';
import { notFound } from '../lib/errors.js';

function overridesOf(db: Db, teamId: string): NamedPromptOverrides {
  const row = db
    .select({ namedPrompts: team.namedPrompts })
    .from(team)
    .where(eq(team.id, teamId))
    .get();
  if (row === undefined) throw notFound(`team ${teamId}`);
  return namedPromptOverridesSchema.parse(row.namedPrompts ?? {});
}

function toRecord(id: NamedPromptId, overrides: NamedPromptOverrides): NamedPromptRecord {
  const { title, text: defaultText } = DEFAULT_NAMED_PROMPTS[id];
  const override = overrides[id];
  return {
    id,
    title,
    defaultText,
    text: override ?? defaultText,
    overridden: override !== undefined,
  };
}

export function listNamedPrompts(db: Db, teamId: string): NamedPromptRecord[] {
  const overrides = overridesOf(db, teamId);
  return NAMED_PROMPT_IDS.map((id) => toRecord(id, overrides));
}

export function resolveNamedPrompt(db: Db, teamId: string, id: NamedPromptId): NamedPromptRecord {
  return toRecord(id, overridesOf(db, teamId));
}

export function putNamedPrompt(
  db: Db,
  teamId: string,
  id: NamedPromptId,
  text: string,
): NamedPromptRecord {
  const next = { ...overridesOf(db, teamId), [id]: text };
  db.update(team).set({ namedPrompts: next }).where(eq(team.id, teamId)).run();
  return toRecord(id, next);
}

export function resetNamedPrompt(db: Db, teamId: string, id: NamedPromptId): NamedPromptRecord {
  const { [id]: _removed, ...rest } = overridesOf(db, teamId);
  db.update(team)
    .set({ namedPrompts: Object.keys(rest).length === 0 ? null : rest })
    .where(eq(team.id, teamId))
    .run();
  return toRecord(id, rest);
}
