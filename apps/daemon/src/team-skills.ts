import { createHash, randomBytes } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { MachineSkillsManifestResponse } from '@cairn/shared';

export const TEAM_SKILLS_CACHE_MAX_ENTRIES = 16;

export const TEAM_SKILLS_BLOB_MAX_ENTRIES = 4096;

export class TeamSkillsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TeamSkillsError';
  }
}

export interface MaterializeTeamSkillsOpts {
  cacheRoot: string;
  manifest: MachineSkillsManifestResponse;
  fetchFile: (dirName: string, path: string) => Promise<Buffer>;
  log?: (msg: string) => void;
  maxEntries?: number;
  maxBlobEntries?: number;
}

export async function materializeTeamSkills(
  opts: MaterializeTeamSkillsOpts,
): Promise<string | null> {
  const { cacheRoot, manifest, fetchFile, log } = opts;
  if (manifest.skills.length === 0) {
    log?.(
      `team-manifest-empty: server distributed zero skills (selection=${manifest.selection}) — running with local skills only`,
    );
    return null;
  }
  const invalid = findUnsafeEntry(manifest);
  if (invalid !== null) throw new TeamSkillsError(`unsafe skill manifest: ${invalid}`);

  const digest = createHash('sha256').update(canonicalize(manifest)).digest('hex');
  const viewsRoot = join(cacheRoot, 'views');
  const blobsRoot = join(cacheRoot, 'blobs');
  const target = join(viewsRoot, digest);
  if (existsSync(target)) {
    touch(target);
    log?.(`team: ${countSkills(manifest)} skill(s) cache hit → ${target}`);
    return target;
  }
  mkdirSync(viewsRoot, { recursive: true });
  mkdirSync(blobsRoot, { recursive: true });
  const tmp = join(viewsRoot, `.tmp-${digest}-${process.pid}-${randomBytes(4).toString('hex')}`);
  let fetched = 0;
  let fetchedBytes = 0;
  let reused = 0;
  try {
    mkdirSync(tmp, { recursive: true });
    for (const skill of manifest.skills) {
      for (const file of skill.files) {
        const blob = join(blobsRoot, file.sha256);
        if (existsSync(blob)) {
          touch(blob);
          reused++;
        } else {
          const bytes = await fetchFile(skill.dirName, file.path);
          assertFileIntegrity(skill.dirName, file, bytes);
          writeBlobAtomically(blobsRoot, blob, bytes);
          fetched++;
          fetchedBytes += bytes.byteLength;
        }
        const dest = join(tmp, skill.dirName, file.path);
        mkdirSync(dirname(dest), { recursive: true });
        linkOrCopy(blob, dest);
      }
    }
    renameSync(tmp, target);
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    if (existsSync(target)) {
      touch(target);
      log?.(`team: ${countSkills(manifest)} skill(s) cache hit → ${target}`);
      return target;
    }
    if (err instanceof TeamSkillsError) throw err;
    throw new TeamSkillsError(
      `materialization failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const fileTotal = countFiles(manifest);
  log?.(
    `team: ${countSkills(manifest)} skill(s), ${fileTotal} file(s) materialized → ${target} ` +
      `(fetched ${fetched} file(s) / ${fetchedBytes} byte(s), reused ${reused})`,
  );
  pruneCache(
    cacheRoot,
    opts.maxEntries ?? TEAM_SKILLS_CACHE_MAX_ENTRIES,
    opts.maxBlobEntries ?? TEAM_SKILLS_BLOB_MAX_ENTRIES,
    log,
  );
  return target;
}

function canonicalize(manifest: MachineSkillsManifestResponse): string {
  return JSON.stringify(
    manifest.skills.map((s) => [
      s.id,
      s.name,
      s.description,
      s.dirName,
      s.files.map((f) => [f.path, f.sizeBytes, f.sha256]),
    ]),
  );
}

function countSkills(manifest: MachineSkillsManifestResponse): number {
  return manifest.skills.length;
}

function countFiles(manifest: MachineSkillsManifestResponse): number {
  return manifest.skills.reduce((n, s) => n + s.files.length, 0);
}

function assertFileIntegrity(
  dirName: string,
  file: { path: string; sizeBytes: number; sha256: string },
  bytes: Buffer,
): void {
  if (bytes.byteLength !== file.sizeBytes) {
    throw new TeamSkillsError(
      `size mismatch for ${dirName}/${file.path}: manifest says ${file.sizeBytes} bytes, got ${bytes.byteLength}`,
    );
  }
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== file.sha256) {
    throw new TeamSkillsError(
      `sha256 mismatch for ${dirName}/${file.path}: manifest says ${file.sha256}, got ${actual}`,
    );
  }
}

function writeBlobAtomically(blobsRoot: string, blob: string, bytes: Buffer): void {
  const tmp = join(
    blobsRoot,
    `.tmp-${createHash('sha256').update(bytes).digest('hex')}-${process.pid}-${randomBytes(4).toString('hex')}`,
  );
  writeFileSync(tmp, bytes);
  try {
    renameSync(tmp, blob);
  } catch (err) {
    rmSync(tmp, { force: true });
    if (!existsSync(blob)) throw err;
  }
}

function linkOrCopy(blob: string, dest: string): void {
  try {
    linkSync(blob, dest);
  } catch {
    copyFileSync(blob, dest);
  }
}

function touch(p: string): void {
  const now = new Date();
  utimesSync(p, now, now);
}

function isSafeRelPath(p: string): boolean {
  if (p === '' || p.startsWith('/') || p.includes('\\')) return false;
  const segments = p.split('/');
  return segments.every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

function findUnsafeEntry(manifest: MachineSkillsManifestResponse): string | null {
  for (const skill of manifest.skills) {
    if (!isSafeRelPath(skill.dirName) || skill.dirName.includes('/')) {
      return `unsafe skill dirName ${JSON.stringify(skill.dirName)}`;
    }
    for (const file of skill.files) {
      if (!isSafeRelPath(file.path)) {
        return `unsafe file path ${JSON.stringify(file.path)} in skill ${skill.dirName}`;
      }
    }
  }
  return null;
}

function pruneCache(
  cacheRoot: string,
  maxViewEntries: number,
  maxBlobEntries: number,
  log?: (msg: string) => void,
): void {
  try {
    pruneDirLru(join(cacheRoot, 'views'), maxViewEntries);
    pruneDirLru(join(cacheRoot, 'blobs'), maxBlobEntries);
    pruneDirLru(join(cacheRoot, 'plugins'), maxViewEntries);
    for (const name of readdirSync(cacheRoot)) {
      if (name === 'views' || name === 'blobs' || name === 'plugins') continue;
      rmSync(join(cacheRoot, name), { recursive: true, force: true });
    }
  } catch (err) {
    log?.(`team-prune: failed (${err instanceof Error ? err.message : String(err)})`);
  }
}

function pruneDirLru(dir: string, maxEntries: number): void {
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir)
    .map((name) => {
      const p = join(dir, name);
      return { p, mtimeMs: statSync(p).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const entry of entries.slice(maxEntries)) {
    rmSync(entry.p, { recursive: true, force: true });
  }
}

export const TEAM_SKILLS_PLUGIN_NAME = 'cairn-team-skills';

export interface EnsureTeamSkillsPluginOpts {
  cacheRoot: string;
  viewDir: string;
  dirNames: readonly string[];
  maxEntries?: number;
  log?: (msg: string) => void;
}

export function ensureTeamSkillsPlugin(opts: EnsureTeamSkillsPluginOpts): string | null {
  const { cacheRoot, viewDir, log } = opts;
  const safe: string[] = [];
  for (const dirName of opts.dirNames) {
    if (isSafeRelPath(dirName) && !dirName.includes('/')) {
      safe.push(dirName);
    } else {
      log?.(`plugin: skipped unsafe dirName ${JSON.stringify(dirName)}`);
    }
  }
  if (safe.length === 0) return null;
  const sorted = [...safe].sort();
  const key = createHash('sha256')
    .update(JSON.stringify([basename(viewDir), sorted]))
    .digest('hex');
  const pluginsRoot = join(cacheRoot, 'plugins');
  const target = join(pluginsRoot, key);
  if (existsSync(target)) {
    touch(target);
    return target;
  }
  mkdirSync(pluginsRoot, { recursive: true });
  const tmp = join(pluginsRoot, `.tmp-${key}-${process.pid}-${randomBytes(4).toString('hex')}`);
  try {
    mkdirSync(join(tmp, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(tmp, '.claude-plugin', 'plugin.json'),
      `${JSON.stringify(
        {
          name: TEAM_SKILLS_PLUGIN_NAME,
          description: 'Materialized cairn team skills (native Skill discovery channel)',
          version: '0.0.0',
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    for (const dirName of sorted) {
      const src = join(viewDir, dirName);
      if (!existsSync(src) || !statSync(src).isDirectory()) {
        throw new TeamSkillsError(`skill dir missing in view: ${dirName}`);
      }
      for (const rel of walkFiles(src)) {
        const dest = join(tmp, 'skills', dirName, rel);
        mkdirSync(dirname(dest), { recursive: true });
        linkOrCopy(join(src, rel), dest);
      }
    }
    renameSync(tmp, target);
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    if (existsSync(target)) {
      touch(target);
      return target;
    }
    log?.(`plugin-failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  pruneDirLru(pluginsRoot, opts.maxEntries ?? TEAM_SKILLS_CACHE_MAX_ENTRIES);
  return target;
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string, prefix: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(join(d, entry.name), rel);
      } else if (entry.isFile()) {
        out.push(rel);
      }
    }
  };
  walk(dir, '');
  return out;
}
