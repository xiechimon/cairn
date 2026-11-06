import {
  type HarnessProfileCapability,
  type HarnessProfileMode,
  type HarnessProfileRecord,
  harnessProfileRecordSchema,
  type PatchHarnessProfileBody,
  profileServesCapability,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { harnessProfile } from '../db/schema.js';
import { newRecordId, nowMs } from '../lib/ids.js';

export function harnessProfileOf(db: Db, teamId: string): HarnessProfileRecord | null {
  const row = db.select().from(harnessProfile).where(eq(harnessProfile.teamId, teamId)).get();
  if (row === undefined) return null;
  return harnessProfileRecordSchema.parse({
    id: row.id,
    teamId: row.teamId,
    mode: row.mode,
    capabilities: row.capabilities,
    targets: row.targets,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function harnessProfileModeOf(db: Db, teamId: string): HarnessProfileMode {
  return harnessProfileOf(db, teamId)?.mode ?? 'independent';
}

export function servesHarnessCapability(
  db: Db,
  teamId: string,
  capability: HarnessProfileCapability,
): boolean {
  return profileServesCapability(harnessProfileOf(db, teamId), capability);
}

export function upsertHarnessProfile(
  db: Db,
  teamId: string,
  patch: PatchHarnessProfileBody,
): HarnessProfileRecord {
  const now = nowMs();
  const existing = harnessProfileOf(db, teamId);
  if (existing === null) {
    db.insert(harnessProfile)
      .values({
        id: newRecordId(),
        teamId,
        mode: patch.mode ?? 'independent',
        capabilities: patch.capabilities ?? [],
        targets: patch.targets ?? [],
        version: 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  } else {
    db.update(harnessProfile)
      .set({
        mode: patch.mode ?? existing.mode,
        capabilities: patch.capabilities ?? existing.capabilities,
        targets: patch.targets ?? existing.targets,
        version: existing.version + 1,
        updatedAt: now,
      })
      .where(eq(harnessProfile.teamId, teamId))
      .run();
  }
  const written = harnessProfileOf(db, teamId);
  if (written === null) throw new Error(`harness profile for ${teamId} missing after write`);
  return written;
}
