import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
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

export interface SkillsRoutingSnapshot {
  snapshotAt: string;
  sourceDb: string;
  matcherRevision: string;
  headRevision: string;
  population: { stepCount: number; hitCount: number };
  candidates: SkillInjectCandidate[];
  steps: SnapshotStep[];
}

export interface PopulationRow {
  stepId: string;
  title: string;
  spec: string;
  skillInjection: unknown;
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

function parseFrontmatterDescription(raw: string): string | null {
  if (!raw.startsWith('---')) return null;
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return null;
  const block = raw.slice(3, end).split('\n');
  for (const line of block) {
    const match = /^description:\s*(.*)$/.exec(line.trim());
    if (match) {
      const value = match[1]?.trim() ?? '';
      if (value === '') return null;
      return value.replace(/^['"]|['"]$/g, '');
    }
  }
  return null;
}

export function loadCandidatesFromSkillsDir(skillsDir: string): SkillInjectCandidate[] {
  const root = resolve(skillsDir);
  if (!existsSync(root)) throw new Error(`skills dir not found: ${root}`);
  const names = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const candidates: SkillInjectCandidate[] = [];
  for (const name of names) {
    const skillMd = join(root, name, 'SKILL.md');
    if (!existsSync(skillMd)) continue;
    const description = parseFrontmatterDescription(readFileSync(skillMd, 'utf8'));
    candidates.push({ id: name, name, description });
  }
  return candidates;
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

export function buildSnapshot(input: {
  dbPath: string;
  candidates: SkillInjectCandidate[];
  repoRoot: string;
  snapshotAt?: string;
  home?: string;
}): SkillsRoutingSnapshot {
  const sqlite = openSnapshotDatabase(input.dbPath);
  try {
    const rows = readInjectionPopulation(sqlite);
    const steps: SnapshotStep[] = [];
    let hitCount = 0;
    for (const row of rows) {
      const parsed = skillInjectionSchema.safeParse(row.skillInjection);
      if (!parsed.success) {
        throw new Error(`invalid skillInjection on step ${row.stepId}: ${parsed.error.message}`);
      }
      hitCount += parsed.data.hits.length;
      const title = sanitizeSnapshotText(row.title, { home: input.home });
      const spec = sanitizeSnapshotText(row.spec, { home: input.home });
      steps.push({
        stepId: sanitizeSnapshotText(row.stepId, { home: input.home }),
        title,
        spec,
        taskText: `${title}\n\n${spec}`,
        storedHits: parsed.data.hits.map((hit) => ({
          id: hit.id,
          rule: hit.rule,
          reason: sanitizeSnapshotText(hit.reason, { home: input.home }),
        })),
      });
    }
    steps.sort((a, b) => a.stepId.localeCompare(b.stepId));
    const revisions = readMatcherRevision(input.repoRoot);
    const snapshot: SkillsRoutingSnapshot = {
      snapshotAt: input.snapshotAt ?? new Date().toISOString(),
      sourceDb: sanitizeSnapshotText(resolve(input.dbPath), { home: input.home }),
      matcherRevision: revisions.matcherRevision,
      headRevision: revisions.headRevision,
      population: { stepCount: steps.length, hitCount },
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

function printHelp(): void {
  process.stdout.write(`Usage:
  pnpm exec tsx integration/eval/skills-routing/snapshot.mts --db <server.db> --out <snapshot.json> (--skills-dir <dir> | --catalog <catalog.json>) [--repo <root>]
`);
}

function parseArgs(argv: string[]): {
  db?: string;
  out?: string;
  skillsDir?: string;
  catalog?: string;
  repo?: string;
  help: boolean;
} {
  const out: {
    db?: string;
    out?: string;
    skillsDir?: string;
    catalog?: string;
    repo?: string;
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
  });
  writeFileSync(args.out, `${JSON.stringify(snapshot, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify(
      {
        out: args.out,
        stepCount: snapshot.population.stepCount,
        hitCount: snapshot.population.hitCount,
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
