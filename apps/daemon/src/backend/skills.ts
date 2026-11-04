import { constants, readFileSync, realpathSync } from 'node:fs';
import { access as fsAccess, readFile as fsReadFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, sep } from 'node:path';
import type { SkillsInjectionNames } from '@cairn/shared';
import {
  DefaultResourceLoader,
  detectSupportedImageMimeTypeFromFile,
  formatSkillsForPrompt,
  loadSkills,
  type ReadOperations,
  type ResourceDiagnostic,
  SettingsManager,
  type Skill,
} from '@earendil-works/pi-coding-agent';

export const SKILLS_CATALOG_BUDGET_BYTES = 1 << 20;

const NO_PI_DEFAULT_AGENT_DIR = join(homedir(), '.cairn-no-such', 'agent');

function classifySkillDiagnostic(d: ResourceDiagnostic): string {
  if (d.type === 'collision') return 'collision';
  if (/does not exist|ENOENT|no such file/i.test(d.message)) return 'missing-skill-md';
  if (/^(name|description)\b|frontmatter|parse/i.test(d.message)) return 'invalid-frontmatter';
  return 'invalid';
}

export interface SkillsCatalogOpts {
  skillsDir: string;
  cwd: string;
  allowlist?: string[];
  injectedSkills?: string[];
  teamSkillsDir?: string;
  worktreeSkillsDirs?: string[];
  budgetBytes?: number;
  log?: (msg: string) => void;
  onResolved?: (names: SkillsInjectionNames) => void;
}

function scanSessionSkills(
  skills: { skillsDir: string; cwd: string },
  teamSkillsDir: string | undefined,
  worktreeSkillsDirs?: string[],
): { skills: Skill[]; diagnostics: ResourceDiagnostic[] } {
  const skillPaths =
    teamSkillsDir !== undefined ? [teamSkillsDir, skills.skillsDir] : [skills.skillsDir];
  if (worktreeSkillsDirs !== undefined && worktreeSkillsDirs.length > 0) {
    skillPaths.push(...worktreeSkillsDirs);
  }
  return loadSkills({
    cwd: skills.cwd,
    agentDir: NO_PI_DEFAULT_AGENT_DIR,
    skillPaths,
    includeDefaults: false,
  });
}

function isIdenticalMirror(winnerPath: string, loserPath: string): boolean {
  try {
    return readFileSync(winnerPath).equals(readFileSync(loserPath));
  } catch {
    return false;
  }
}

function orderSkillsByBinding(skills: Skill[], order: readonly string[] | undefined): Skill[] {
  if (order === undefined) return skills;
  const byName = new Map(skills.map((s) => [s.name, s]));
  return order.flatMap((id) => {
    const s = byName.get(id);
    return s === undefined ? [] : [s];
  });
}

function fitSkillsToBudget(
  skills: Skill[],
  budgetBytes: number,
): { kept: Skill[]; dropped: Skill[]; totalBytes: number } {
  const bytes = (n: number): number =>
    Buffer.byteLength(formatSkillsForPrompt(skills.slice(0, n), 'read'), 'utf8');
  let lo = 0;
  let hi = skills.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (bytes(mid) <= budgetBytes) lo = mid;
    else hi = mid - 1;
  }
  const totalBytes = bytes(skills.length);
  return { kept: skills.slice(0, lo), dropped: skills.slice(lo), totalBytes };
}

function listDroppedNames(dropped: readonly Skill[]): string {
  const names = dropped.map((s) => s.name);
  return names.length <= 100
    ? names.join(', ')
    : `${names.slice(0, 100).join(', ')} +${names.length - 100} more`;
}

export function buildSkillsCatalog(opts: SkillsCatalogOpts): string {
  const log = opts.log;
  let skills: Skill[];
  let diagnostics: ResourceDiagnostic[];
  try {
    const result = scanSessionSkills(opts, opts.teamSkillsDir, opts.worktreeSkillsDirs);
    skills = result.skills;
    diagnostics = result.diagnostics;
  } catch (err) {
    log?.(`invalid: ${err instanceof Error ? err.message : String(err)}`);
    log?.('catalog: entries=0 chars=0 bytes=0');
    opts.onResolved?.({ injected: [], omitted: [], unrendered: [] });
    return '';
  }
  let identicalMirrors = 0;
  for (const d of diagnostics) {
    if (
      d.type === 'collision' &&
      d.collision !== undefined &&
      isIdenticalMirror(d.collision.winnerPath, d.collision.loserPath)
    ) {
      identicalMirrors++;
      continue;
    }
    const where =
      d.collision !== undefined
        ? ` (winner=${d.collision.winnerPath} loser=${d.collision.loserPath})`
        : d.path !== undefined
          ? ` (${d.path})`
          : '';
    log?.(`${classifySkillDiagnostic(d)}: ${d.message}${where}`);
  }
  if (identicalMirrors > 0) {
    log?.(
      `collision: ${identicalMirrors} identical mirror(s) deduped (team view wins; ` +
        `budget counts the merged set once)`,
    );
  }
  if (opts.allowlist !== undefined) {
    const allowed = new Set(opts.allowlist);
    const kept: Skill[] = [];
    for (const s of skills) {
      if (allowed.has(s.name)) kept.push(s);
      else log?.(`filtered: ${s.name} not in agent allowlist`);
    }
    skills = kept;
  }
  const injected = opts.injectedSkills;
  if (injected !== undefined) {
    const selected = new Set(injected);
    const kept: Skill[] = [];
    for (const s of skills) {
      if (selected.has(s.name)) kept.push(s);
      else log?.(`filtered: ${s.name} not in injected selection`);
    }
    skills = kept;
  }
  skills = orderSkillsByBinding(skills, injected ?? opts.allowlist);
  const budgetable = skills.filter((s) => !s.disableModelInvocation);
  const budget = opts.budgetBytes ?? SKILLS_CATALOG_BUDGET_BYTES;
  const { kept, dropped, totalBytes } = fitSkillsToBudget(budgetable, budget);
  let catalog = formatSkillsForPrompt(kept, 'read');
  if (dropped.length > 0) {
    const names = listDroppedNames(dropped);
    log?.(`budget: total=${totalBytes} budget=${budget} dropped=${dropped.length}: ${names}`);
    catalog +=
      `\n\n<omitted_skills reason="byte-budget" budget="${budget}">\n` +
      `The following skills exist but were omitted from the catalog to fit the byte budget: ${names}\n` +
      `</omitted_skills>`;
  }
  if (skills.length > 0) {
    log?.(
      opts.teamSkillsDir !== undefined
        ? `loaded: ${skills.length} skills from ${opts.teamSkillsDir} + ${opts.skillsDir}`
        : `loaded: ${skills.length} skills from ${opts.skillsDir}`,
    );
  }
  log?.(
    `catalog: entries=${kept.length} chars=${catalog.length} bytes=${Buffer.byteLength(catalog, 'utf8')}`,
  );
  opts.onResolved?.({
    injected: kept.map((s) => s.name),
    omitted: dropped.map((s) => s.name),
    unrendered: skills.filter((s) => s.disableModelInvocation).map((s) => s.name),
  });
  return catalog;
}

export function appendSkillsCatalog(base: string | undefined, catalog: string): string | undefined {
  if (catalog === '') return base;
  if (base === undefined || base === '') return catalog.replace(/^\n+/, '');
  return base + catalog;
}

export function composeSkillsSection(
  skills: { skillsDir: string; cwd: string } | undefined,
  opts: {
    skillsAllowlist?: string[];
    injectedSkills?: string[];
    teamSkillsDir?: string;
    worktreeSkillsDirs?: string[];
    onSkillsResolved?: (names: SkillsInjectionNames) => void;
  },
  log?: (msg: string) => void,
): string {
  if (!skills) {
    opts.onSkillsResolved?.({ injected: [], omitted: [], unrendered: [] });
    return '';
  }
  return buildSkillsCatalog({
    skillsDir: skills.skillsDir,
    cwd: skills.cwd,
    ...(opts.skillsAllowlist !== undefined ? { allowlist: opts.skillsAllowlist } : {}),
    ...(opts.injectedSkills !== undefined ? { injectedSkills: opts.injectedSkills } : {}),
    ...(opts.teamSkillsDir !== undefined ? { teamSkillsDir: opts.teamSkillsDir } : {}),
    ...(opts.worktreeSkillsDirs !== undefined
      ? { worktreeSkillsDirs: opts.worktreeSkillsDirs }
      : {}),
    ...(opts.onSkillsResolved !== undefined ? { onResolved: opts.onSkillsResolved } : {}),
    ...(log ? { log } : {}),
  });
}

export interface DeniedSkillEntry {
  name: string;
  baseDir: string;
}

export function collectDeniedSkillDirs(
  skills: { skillsDir: string; cwd: string } | undefined,
  opts: { skillsAllowlist?: string[]; teamSkillsDir?: string; worktreeSkillsDirs?: string[] },
): DeniedSkillEntry[] {
  if (!skills || opts.skillsAllowlist === undefined) return [];
  let loaded: Skill[];
  try {
    loaded = scanSessionSkills(skills, opts.teamSkillsDir, opts.worktreeSkillsDirs).skills;
  } catch {
    return [];
  }
  const allowed = new Set(opts.skillsAllowlist);
  return loaded
    .filter((s) => !allowed.has(s.name))
    .map((s) => ({ name: s.name, baseDir: s.baseDir }));
}

export function collectVisibleSkillNames(opts: SkillsCatalogOpts): Set<string> {
  let skills: Skill[];
  try {
    skills = scanSessionSkills(opts, opts.teamSkillsDir, opts.worktreeSkillsDirs).skills;
  } catch {
    return new Set();
  }
  if (opts.allowlist !== undefined) {
    const allowed = new Set(opts.allowlist);
    skills = skills.filter((s) => allowed.has(s.name));
  }
  if (opts.injectedSkills !== undefined) {
    const selected = new Set(opts.injectedSkills);
    skills = skills.filter((s) => selected.has(s.name));
  }
  return new Set(skills.map((s) => s.name));
}

export function piWorktreeSkillDirs(cwd: string): string[] {
  return [join(cwd, '.claude', 'skills'), join(cwd, '.pi', 'skills')];
}

export function collectVisibleSkillFileMap(opts: SkillsCatalogOpts): Map<string, string> {
  let skills: Skill[];
  try {
    skills = scanSessionSkills(opts, opts.teamSkillsDir, opts.worktreeSkillsDirs).skills;
  } catch {
    return new Map();
  }
  if (opts.allowlist !== undefined) {
    const allowed = new Set(opts.allowlist);
    skills = skills.filter((s) => allowed.has(s.name));
  }
  if (opts.injectedSkills !== undefined) {
    const selected = new Set(opts.injectedSkills);
    skills = skills.filter((s) => selected.has(s.name));
  }
  return new Map(skills.map((s) => [s.name, s.filePath]));
}

export interface TeamSkillEntry {
  name: string;
  dirName: string;
  baseDir: string;
}

export function collectTeamSkillEntries(
  skills: { skillsDir: string; cwd: string } | undefined,
  opts: { skillsAllowlist?: string[]; teamSkillsDir?: string },
): TeamSkillEntry[] {
  if (!skills || opts.teamSkillsDir === undefined) return [];
  let loaded: Skill[];
  try {
    loaded = scanSessionSkills(skills, opts.teamSkillsDir).skills;
  } catch {
    return [];
  }
  const resolve = (p: string): string => {
    try {
      return realpathSync(p);
    } catch {
      return p;
    }
  };
  const viewReal = resolve(opts.teamSkillsDir);
  const allowed = opts.skillsAllowlist !== undefined ? new Set(opts.skillsAllowlist) : null;
  const out: TeamSkillEntry[] = [];
  for (const s of loaded) {
    if (allowed !== null && !allowed.has(s.name)) continue;
    const baseReal = resolve(s.baseDir);
    if (baseReal !== viewReal && !baseReal.startsWith(viewReal + sep)) continue;
    out.push({ name: s.name, dirName: basename(s.baseDir), baseDir: s.baseDir });
  }
  return out;
}

export interface SkillReadGate {
  check(absolutePath: string): DeniedSkillEntry | null;
  operations: ReadOperations;
}

export function createSkillReadGate(
  denied: readonly DeniedSkillEntry[],
  log?: (msg: string) => void,
): SkillReadGate {
  const resolve = (p: string): string => {
    try {
      return realpathSync(p);
    } catch {
      return p;
    }
  };
  const resolvedEntries = denied.map((entry) => ({ entry, resolved: resolve(entry.baseDir) }));
  const check = (absolutePath: string): DeniedSkillEntry | null => {
    const target = resolve(absolutePath);
    for (const { entry, resolved } of resolvedEntries) {
      if (target === resolved || target.startsWith(resolved + sep)) return entry;
    }
    return null;
  };
  const guard = async (absolutePath: string): Promise<void> => {
    const hit = check(absolutePath);
    if (hit === null) return;
    log?.(`denied-read: ${absolutePath} (skill ${hit.name} not in allowlist)`);
    throw new Error(`read denied: skill '${hit.name}' is not in the agent allowlist`);
  };
  return {
    check,
    operations: {
      readFile: async (absolutePath: string) => {
        await guard(absolutePath);
        return fsReadFile(absolutePath);
      },
      access: async (absolutePath: string) => {
        await guard(absolutePath);
        return fsAccess(absolutePath, constants.R_OK);
      },
      detectImageMimeType: detectSupportedImageMimeTypeFromFile,
    },
  };
}

export async function discoverNativeSkills(opts: {
  agentDir: string;
  cwd: string;
}): Promise<string[]> {
  const loader = new DefaultResourceLoader({
    cwd: opts.cwd,
    agentDir: opts.agentDir,
    settingsManager: SettingsManager.inMemory({ compaction: { enabled: true } }),
  });
  await loader.reload();
  return loader.getSkills().skills.map((s) => s.name);
}
