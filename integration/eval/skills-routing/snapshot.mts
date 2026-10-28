import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  parseSkillFrontmatter,
  SKILL_ENTRY_FILE,
  type SkillInjectCandidate,
  type SkillInjectHit,
  skillInjectionSchema,
} from '@cairn/shared';
import { sanitizeSnapshotText, sanitizeSnapshotValue } from './sanitize.mts';

export interface SnapshotStep {
  stepId: string;
  title: string;
  spec: string;
  taskText: string;
  storedHits: SkillInjectHit[];
}

export interface SnapshotSampling {
  method: 'full' | 'stratified-by-rule-skill';
  targetHitCount: number | null;
  seed: string;
  sampledHitCount: number;
  sampledStepCount: number;
}

export interface SkillsRoutingSnapshot {
  snapshotAt: string;
  sourceDb: string;
  matcherRevision: string;
  headRevision: string;
  livePopulation: { stepCount: number; hitCount: number };
  population: { stepCount: number; hitCount: number };
  sampling: SnapshotSampling;
  candidates: SkillInjectCandidate[];
  steps: SnapshotStep[];
}

export interface PopulationRow {
  stepId: string;
  title: string;
  spec: string;
  skillInjection: unknown;
}

export interface FlatHit {
  stepId: string;
  title: string;
  spec: string;
  hit: SkillInjectHit;
}

const SKILL_INJECT_PATH = 'packages/shared/src/skill-inject.ts';

export function openSnapshotDatabase(dbPath: string): DatabaseSync {
  return new DatabaseSync(resolve(dbPath), { readOnly: true });
}

export function readInjectionPopulation(sqlite: DatabaseSync): PopulationRow[] {
  const rows = sqlite
    .prepare(
      `SELECT step.id AS stepId, todo.title AS title, todo.spec AS spec, step.skillInjection AS skillInjection
       FROM step
       INNER JOIN build ON build.id = step.buildId
       INNER JOIN todo ON todo.id = build.todoId
       WHERE step.skillInjection IS NOT NULL`,
    )
    .all() as Array<{
    stepId: string;
    title: string;
    spec: string;
    skillInjection: string | null;
  }>;
  return rows.map((row) => ({
    stepId: row.stepId,
    title: row.title,
    spec: row.spec,
    skillInjection:
      row.skillInjection === null || row.skillInjection === ''
        ? null
        : JSON.parse(row.skillInjection),
  }));
}

export function flattenPopulationHits(rows: PopulationRow[]): FlatHit[] {
  const out: FlatHit[] = [];
  for (const row of rows) {
    const parsed = skillInjectionSchema.safeParse(row.skillInjection);
    if (!parsed.success) {
      throw new Error(`invalid skillInjection on step ${row.stepId}: ${parsed.error.message}`);
    }
    for (const hit of parsed.data.hits) {
      out.push({
        stepId: row.stepId,
        title: row.title,
        spec: row.spec,
        hit,
      });
    }
  }
  return out;
}

function hashSeed(text: string): number {
  const digest = createHash('sha256').update(text).digest();
  return digest.readUInt32BE(0);
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function stratumKey(hit: FlatHit): string {
  return `${hit.hit.rule}\0${hit.hit.id}`;
}

export function stratifyHits(
  hits: readonly FlatHit[],
  targetHitCount: number,
  seed: string,
): FlatHit[] {
  if (targetHitCount <= 0) throw new Error('targetHitCount must be positive');
  if (hits.length <= targetHitCount) return [...hits];
  const byStratum = new Map<string, FlatHit[]>();
  for (const hit of hits) {
    const key = stratumKey(hit);
    const bucket = byStratum.get(key);
    if (bucket === undefined) byStratum.set(key, [hit]);
    else bucket.push(hit);
  }
  const rng = mulberry32(hashSeed(seed));
  for (const bucket of byStratum.values()) {
    for (let i = bucket.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = bucket[i] as FlatHit;
      bucket[i] = bucket[j] as FlatHit;
      bucket[j] = tmp;
    }
  }
  const strata = [...byStratum.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const selected: FlatHit[] = [];
  const cursors = new Map<string, number>();
  for (const [key] of strata) cursors.set(key, 0);
  while (selected.length < targetHitCount) {
    let progressed = false;
    for (const [key, bucket] of strata) {
      if (selected.length >= targetHitCount) break;
      const cursor = cursors.get(key) ?? 0;
      if (cursor >= bucket.length) continue;
      selected.push(bucket[cursor] as FlatHit);
      cursors.set(key, cursor + 1);
      progressed = true;
    }
    if (!progressed) break;
  }
  return selected;
}

export function loadCandidatesFromSkillsDir(skillsDir: string): SkillInjectCandidate[] {
  const root = resolve(skillsDir);
  if (!existsSync(root)) throw new Error(`skills dir not found: ${root}`);
  let entryNames: string[];
  try {
    entryNames = readdirSync(root, { withFileTypes: true }).map((entry) => entry.name);
  } catch (error) {
    throw new Error(
      `skills dir unreadable: ${root}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const dirNames: string[] = [];
  for (const name of entryNames) {
    try {
      if (statSync(join(root, name)).isDirectory()) dirNames.push(name);
    } catch {}
  }
  dirNames.sort((a, b) => a.localeCompare(b));
  const out: SkillInjectCandidate[] = [];
  const seenReal = new Set<string>();
  const seenId = new Set<string>();
  for (const dirName of dirNames) {
    const dir = join(root, dirName);
    let real: string;
    try {
      real = realpathSync(dir);
    } catch {
      continue;
    }
    if (seenReal.has(real)) continue;
    let content: string;
    try {
      if (!readdirSync(dir).includes(SKILL_ENTRY_FILE)) continue;
      content = readFileSync(join(dir, SKILL_ENTRY_FILE), 'utf8');
    } catch {
      continue;
    }
    seenReal.add(real);
    const fm = parseSkillFrontmatter(content);
    const id = fm.name ?? dirName;
    if (seenId.has(id)) continue;
    seenId.add(id);
    out.push({ id, name: id, description: fm.description ?? null });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function loadCandidatesFromFile(path: string): SkillInjectCandidate[] {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as SkillInjectCandidate[];
  if (!Array.isArray(raw)) throw new Error(`catalog must be an array: ${path}`);
  return raw;
}

function gitSha(repoRoot: string, args: string[]): string {
  const result = spawnSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed: ${result.stderr.trim() || result.stdout.trim() || 'unknown'}`,
    );
  }
  return result.stdout.trim();
}

export function readMatcherRevision(repoRoot: string): {
  matcherRevision: string;
  headRevision: string;
} {
  return {
    matcherRevision: gitSha(repoRoot, ['log', '-1', '--format=%H', '--', SKILL_INJECT_PATH]),
    headRevision: gitSha(repoRoot, ['rev-parse', 'HEAD']),
  };
}

function stepsFromHits(hits: readonly FlatHit[], home?: string): SnapshotStep[] {
  const byStep = new Map<string, { title: string; spec: string; hits: SkillInjectHit[] }>();
  for (const row of hits) {
    const existing = byStep.get(row.stepId);
    if (existing === undefined) {
      byStep.set(row.stepId, {
        title: row.title,
        spec: row.spec,
        hits: [row.hit],
      });
    } else {
      existing.hits.push(row.hit);
    }
  }
  const steps: SnapshotStep[] = [];
  for (const [stepId, row] of [...byStep.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const title = sanitizeSnapshotText(row.title, { home });
    const spec = sanitizeSnapshotText(row.spec, { home });
    steps.push({
      stepId: sanitizeSnapshotText(stepId, { home }),
      title,
      spec,
      taskText: `${title}\n\n${spec}`,
      storedHits: row.hits.map((hit) => ({
        id: hit.id,
        rule: hit.rule,
        reason: sanitizeSnapshotText(hit.reason, { home }),
      })),
    });
  }
  return steps;
}

export function buildSnapshot(input: {
  dbPath: string;
  candidates: SkillInjectCandidate[];
  repoRoot: string;
  snapshotAt?: string;
  home?: string;
  stratifyHitCount?: number;
  sampleSeed?: string;
}): SkillsRoutingSnapshot {
  const sqlite = openSnapshotDatabase(input.dbPath);
  try {
    const rows = readInjectionPopulation(sqlite);
    const allHits = flattenPopulationHits(rows);
    const liveStepIds = new Set(rows.map((row) => row.stepId));
    const seed =
      input.sampleSeed ??
      `${allHits.length}:${liveStepIds.size}:${input.stratifyHitCount ?? 'full'}`;
    const sampledHits =
      input.stratifyHitCount === undefined
        ? allHits
        : stratifyHits(allHits, input.stratifyHitCount, seed);
    const steps = stepsFromHits(sampledHits, input.home);
    const hitCount = steps.reduce((sum, step) => sum + step.storedHits.length, 0);
    const revisions = readMatcherRevision(input.repoRoot);
    const sampling: SnapshotSampling = {
      method:
        input.stratifyHitCount === undefined || sampledHits.length === allHits.length
          ? 'full'
          : 'stratified-by-rule-skill',
      targetHitCount: input.stratifyHitCount ?? null,
      seed,
      sampledHitCount: hitCount,
      sampledStepCount: steps.length,
    };
    const snapshot: SkillsRoutingSnapshot = {
      snapshotAt: input.snapshotAt ?? new Date().toISOString(),
      sourceDb: sanitizeSnapshotText(resolve(input.dbPath), { home: input.home }),
      matcherRevision: revisions.matcherRevision,
      headRevision: revisions.headRevision,
      livePopulation: { stepCount: liveStepIds.size, hitCount: allHits.length },
      population: { stepCount: steps.length, hitCount },
      sampling,
      candidates: input.candidates.map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        description:
          candidate.description === null
            ? null
            : sanitizeSnapshotText(candidate.description, { home: input.home }),
      })),
      steps,
    };
    return sanitizeSnapshotValue(snapshot, { home: input.home }) as SkillsRoutingSnapshot;
  } finally {
    sqlite.close();
  }
}

export function assertLiveSourceDb(sourceDb: string): void {
  if (sourceDb.startsWith('fixture://')) {
    throw new Error(`committed baseline sourceDb must be a live DB path, got ${sourceDb}`);
  }
  if (!sourceDb.endsWith('server.db')) {
    throw new Error(`committed baseline sourceDb must end with server.db, got ${sourceDb}`);
  }
}

function printHelp(): void {
  process.stdout.write(`Usage:
  pnpm exec tsx integration/eval/skills-routing/snapshot.mts --db <server.db> --out <snapshot.json> (--skills-dir <dir> | --catalog <catalog.json>) [--repo <root>] [--stratify-hits <n>] [--sample-seed <text>]
`);
}

function parseArgs(argv: string[]): {
  db?: string;
  out?: string;
  skillsDir?: string;
  catalog?: string;
  repo?: string;
  stratifyHits?: number;
  sampleSeed?: string;
  help: boolean;
} {
  const out: {
    db?: string;
    out?: string;
    skillsDir?: string;
    catalog?: string;
    repo?: string;
    stratifyHits?: number;
    sampleSeed?: string;
    help: boolean;
  } = { help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg === '--db') out.db = argv[++i];
    else if (arg === '--out') out.out = argv[++i];
    else if (arg === '--skills-dir') out.skillsDir = argv[++i];
    else if (arg === '--catalog') out.catalog = argv[++i];
    else if (arg === '--repo') out.repo = argv[++i];
    else if (arg === '--stratify-hits') {
      const raw = argv[++i];
      const value = Number(raw);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`--stratify-hits expects a positive integer, got ${raw}`);
      }
      out.stratifyHits = value;
    } else if (arg === '--sample-seed') out.sampleSeed = argv[++i];
    else throw new Error(`unknown argument: ${arg}`);
  }
  return out;
}

function main(argv: string[]): number {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }
  if (args.db === undefined || args.out === undefined) {
    printHelp();
    return 1;
  }
  if ((args.skillsDir === undefined) === (args.catalog === undefined)) {
    process.stderr.write('provide exactly one of --skills-dir or --catalog\n');
    return 1;
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(args.repo ?? join(here, '../../..'));
  const candidates =
    args.catalog !== undefined
      ? loadCandidatesFromFile(args.catalog)
      : loadCandidatesFromSkillsDir(args.skillsDir as string);
  const snapshot = buildSnapshot({
    dbPath: args.db,
    candidates,
    repoRoot,
    stratifyHitCount: args.stratifyHits,
    sampleSeed: args.sampleSeed,
  });
  writeFileSync(args.out, `${JSON.stringify(snapshot, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify(
      {
        out: args.out,
        sourceDb: snapshot.sourceDb,
        livePopulation: snapshot.livePopulation,
        population: snapshot.population,
        sampling: snapshot.sampling,
        candidateCount: snapshot.candidates.length,
        matcherRevision: snapshot.matcherRevision,
      },
      null,
      2,
    )}\n`,
  );
  return 0;
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  process.exitCode = main(process.argv.slice(2));
}
