import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { basename, join, sep } from 'node:path';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { dataMigration, team } from '../db/schema.js';
import { nowMs } from '../lib/ids.js';
import { readSkillSource, writeSkillSource } from './skill-source-store.js';
import { pathsOverlap, scanLocalSkills, scanSkillsRoot, sharedAgentSkillRoots } from './skills.js';

export const SKILLS_HOME_MIGRATION_ID = 'skills-home-v1';

const STAGING_DIR = '.migrating';

export type SkillsHomeOutcome =
  | { kind: 'shared' }
  | { kind: 'pinned' }
  | { kind: 'done' }
  | { kind: 'fresh' }
  | { kind: 'migrated'; copied: string[]; skipped: { id: string; reason: string }[] };

export interface SkillsHomeOpts {
  db: Db;
  skillsDir: string;
  pinned: boolean;
  legacyDir: string;
  skillSourcesPath: string;
  sharedRoots?: string[];
}

function linkLeavingRoot(root: string): string | null {
  const walk = (dir: string): string | null => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        const real = realpathSync(full);
        if (!real.startsWith(root + sep) || statSync(real).isDirectory()) return full;
      } else if (entry.isDirectory()) {
        const found = walk(full);
        if (found !== null) return found;
      }
    }
    return null;
  };
  return walk(root);
}

function isExistsError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'EEXIST' || code === 'ENOTEMPTY';
}

export async function prepareSkillsHome(opts: SkillsHomeOpts): Promise<SkillsHomeOutcome> {
  const readOnlyRoots = [...(opts.sharedRoots ?? sharedAgentSkillRoots()), opts.legacyDir];
  if (readOnlyRoots.some((root) => pathsOverlap(opts.skillsDir, root))) return { kind: 'shared' };
  mkdirSync(opts.skillsDir, { recursive: true });
  if (opts.pinned) return { kind: 'pinned' };
  const marker = opts.db
    .select()
    .from(dataMigration)
    .where(eq(dataMigration.id, SKILLS_HOME_MIGRATION_ID))
    .get();
  if (marker) return { kind: 'done' };
  const recordMarker = (detail: unknown) =>
    opts.db
      .insert(dataMigration)
      .values({ id: SKILLS_HOME_MIGRATION_ID, doneAt: nowMs(), detail: JSON.stringify(detail) })
      .onConflictDoNothing()
      .run();
  if (opts.db.select({ id: team.id }).from(team).limit(1).get() === undefined) {
    recordMarker({ kind: 'fresh' });
    return { kind: 'fresh' };
  }

  const staging = join(opts.skillsDir, STAGING_DIR);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging);
  const taken = new Set(scanLocalSkills(opts.skillsDir).map((s) => s.id));
  const copied: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const skill of scanSkillsRoot(opts.legacyDir, false)) {
    const dest = join(opts.skillsDir, skill.dirName);
    if (taken.has(skill.id) || existsSync(dest)) {
      skipped.push({ id: skill.id, reason: 'already in the Cairn skills directory' });
      continue;
    }
    const tmp = join(staging, skill.dirName);
    try {
      const source = realpathSync(skill.dir);
      const link = linkLeavingRoot(source);
      if (link !== null) {
        skipped.push({ id: skill.id, reason: `holds a link Cairn will not follow: ${link}` });
        continue;
      }
      cpSync(source, tmp, {
        recursive: true,
        dereference: true,
        force: false,
        errorOnExist: true,
        filter: (path) => basename(path) !== '.git',
      });
      try {
        renameSync(tmp, dest);
      } catch (error) {
        if (!isExistsError(error)) throw error;
        skipped.push({ id: skill.id, reason: 'already in the Cairn skills directory' });
        continue;
      }
      if (readSkillSource(opts.skillSourcesPath, skill.id) === null) {
        await writeSkillSource(opts.skillSourcesPath, {
          skillId: skill.id,
          kind: 'localPath',
          ref: source,
          importedAt: nowMs(),
          refreshedAt: null,
        });
      }
      copied.push(skill.id);
    } catch (error) {
      rmSync(tmp, { recursive: true, force: true });
      skipped.push({
        id: skill.id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  rmSync(staging, { recursive: true, force: true });
  recordMarker({ kind: 'migrated', from: opts.legacyDir, copied, skipped });
  return { kind: 'migrated', copied, skipped };
}
