import { PERSONA_PROFILES, type PersonaRole } from '@cairn/shared';
import { and, asc, eq, like } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { agent, machine as machineTable, provider as providerTable, team } from '../db/schema.js';
import { newRecordId } from '../lib/ids.js';
import { mergedCatalogModels } from './model-liveness.js';

function pickPersonaModel(db: Db, teamId: string): { provider: string; modelId: string } | null {
  const aliveFromCatalog = mergedCatalogModels().find((m) => m.liveness !== 'dead');
  if (aliveFromCatalog !== undefined) {
    const p = db
      .select()
      .from(providerTable)
      .where(eq(providerTable.teamId, teamId))
      .all()
      .find((row) => row.providerId !== '');
    if (p !== undefined) {
      return { provider: p.providerId, modelId: aliveFromCatalog.id };
    }
  }
  for (const row of db
    .select({ report: machineTable.claudeCodeReport })
    .from(machineTable)
    .where(eq(machineTable.teamId, teamId))
    .orderBy(asc(machineTable.name))
    .all()) {
    const report = row.report;
    if (report === null || report.models.length === 0) continue;
    // biome-ignore lint/style/noNonNullAssertion: guard above ensures models is non-empty, so [0] is defined
    const model = report.models.find((m) => m.slot === 'default') ?? report.models[0]!;
    return { provider: 'claude-code', modelId: model.id };
  }
  for (const p of db.select().from(providerTable).where(eq(providerTable.teamId, teamId)).all()) {
    const model = p.models.find((m) => m.id !== '');
    if (model !== undefined && p.providerId !== '') {
      return { provider: p.providerId, modelId: model.id };
    }
  }
  return null;
}

function pickPersonaHome(db: Db, teamId: string): string | null {
  const row = db
    .select({ id: machineTable.id })
    .from(machineTable)
    .where(and(eq(machineTable.teamId, teamId), like(machineTable.name, 'mea%')))
    .get();
  return row?.id ?? null;
}

export function ensurePersonasSeeded(db: Db, teamId: string): number {
  const pick = pickPersonaModel(db, teamId);
  const home = pickPersonaHome(db, teamId);
  let inserted = 0;
  for (const profile of PERSONA_PROFILES) {
    const existing = db
      .select()
      .from(agent)
      .where(and(eq(agent.teamId, teamId), eq(agent.persona, profile.role)))
      .get();
    if (existing !== undefined) {
      if (existing.modelId === null && pick !== null) {
        db.update(agent)
          .set({ provider: pick.provider, modelId: pick.modelId })
          .where(eq(agent.id, existing.id))
          .run();
      }
      if (existing.machineId === null && home !== null) {
        db.update(agent).set({ machineId: home }).where(eq(agent.id, existing.id)).run();
      }
      continue;
    }
    db.insert(agent)
      .values({
        id: newRecordId(),
        teamId,
        displayName: profile.displayName,
        description: profile.description,
        status: 'active',
        avatarUrl: null,
        provider: pick?.provider ?? null,
        modelId: pick?.modelId ?? null,
        thinkingLevel: profile.thinkingLevel,
        persona: profile.role,
        tools: [...profile.tools],
        secrets: [],
        defaultSkill: null,
        skillsAllowlist: null,
        mcpServers: [],
        maxConcurrentTasks: null,
        machineId: home,
      })
      .run();
    inserted += 1;
  }
  return inserted;
}

export function backfillPersonas(db: Db): void {
  const rows = db.select({ id: team.id }).from(team).all();
  for (const row of rows) {
    ensurePersonasSeeded(db, row.id);
  }
}

export function personaAgent(
  db: Db,
  teamId: string,
  role: PersonaRole,
): typeof agent.$inferSelect | null {
  return (
    db
      .select()
      .from(agent)
      .where(and(eq(agent.teamId, teamId), eq(agent.persona, role)))
      .get() ?? null
  );
}
