import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type GuardCandidate,
  guardCandidateSchema,
  ticketDedupeKey,
  ticketDedupeMarker,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { ServerConfig } from './config.js';
import type { Db } from './db/client.js';
import { project } from './db/schema.js';
import type { FetchLike } from './lib/github.js';
import { githubCreateIssue } from './lib/github.js';
import { githubRepoOfProject } from './services/git.js';
import { curateCandidates, GUARD_CANDIDATES_FILE } from './trajectory-curate.js';
import { exportTrajectories } from './trajectory-export.js';
import { type ReflectorEndpoint, reflectPacks } from './trajectory-reflect.js';

export const REFLECT_CURATE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface ReflectCurateLogger {
  info(obj: object, msg: string): void;
}

export interface ReflectCurateDeps {
  config: ServerConfig;
  db: Db;
  logger: ReflectCurateLogger;
  model: string;
  endpoint: ReflectorEndpoint;
  now?: () => number;
  openNewGuards?: (guards: GuardCandidate[]) => Promise<number>;
}

export interface ReflectCurateSummary {
  date: string;
  skipped: 'already_done' | 'no_packs' | null;
  exported: number | null;
  reflect: {
    reflected: number;
    notEligible: number;
    candidates: number;
    rejected: number;
  } | null;
  curate: ReturnType<typeof curateCandidates> | null;
  guardIssuesOpened: number;
}

function utcDate(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function readGuardIds(path: string): Set<string> {
  if (!existsSync(path)) return new Set();
  return new Set(
    readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => guardCandidateSchema.parse(JSON.parse(line)).id),
  );
}

function readGuards(path: string): GuardCandidate[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => guardCandidateSchema.parse(JSON.parse(line)));
}

export async function openGuardCandidateIssues(
  deps: {
    db: Db;
    githubFetch: FetchLike;
    tokenForTeam: (teamId: string) => Promise<string | null>;
    logger: ReflectCurateLogger;
  },
  guards: GuardCandidate[],
): Promise<number> {
  let opened = 0;
  for (const guard of guards) {
    const projectRow = deps.db.select().from(project).where(eq(project.id, guard.project)).get();
    const ref = githubRepoOfProject(projectRow);
    const token = await deps.tokenForTeam(guard.teamId);
    if (ref === null || token === null) {
      deps.logger.info(
        { guardId: guard.id, project: guard.project },
        'trajectory reflect-curate skipped guard issue (no github repo or token)',
      );
      continue;
    }
    const key = ticketDedupeKey({ category: `traj-guard:${guard.id}`, paths: [] });
    const body = [
      ticketDedupeMarker(key),
      guard.content,
      '',
      `Builds: ${guard.buildIds.join(', ')}`,
      `Agent: ${guard.agentId}`,
      'Source: scheduled traj:reflect → traj:curate (kind=guard). Confirm before turning into a gate or lesson.',
    ].join('\n');
    try {
      await githubCreateIssue(deps.githubFetch, token, ref.owner, ref.repo, {
        title: `Guard candidate: ${guard.title}`,
        body,
        labels: ['enhancement', 'needs-triage'],
      });
      opened += 1;
    } catch (error) {
      deps.logger.info(
        {
          guardId: guard.id,
          err: error instanceof Error ? error.message : String(error),
        },
        'trajectory reflect-curate guard issue create failed (continues)',
      );
    }
  }
  return opened;
}

export async function sweepReflectCurate(deps: ReflectCurateDeps): Promise<ReflectCurateSummary> {
  const now = deps.now ?? Date.now;
  const date = utcDate(now());
  const reflectDir = join(deps.config.dataDir, 'experience-candidates', 'reflect');
  const outDir = join(deps.config.dataDir, 'experience-candidates');
  const donePath = join(reflectDir, `${date}.done`);
  const candidatesPath = join(reflectDir, `${date}.jsonl`);
  const packsPath = join(deps.config.dataDir, 'trajectory-exports', `${date}.jsonl`);
  const guardsPath = join(outDir, GUARD_CANDIDATES_FILE);
  const empty: ReflectCurateSummary = {
    date,
    skipped: null,
    exported: null,
    reflect: null,
    curate: null,
    guardIssuesOpened: 0,
  };
  if (existsSync(donePath)) return { ...empty, skipped: 'already_done' };

  let exported: number | null = null;
  if (!existsSync(packsPath)) {
    try {
      const res = exportTrajectories(deps.config, { out: packsPath });
      exported = res.exported;
    } catch (error) {
      deps.logger.info(
        { err: error instanceof Error ? error.message : String(error), date },
        'trajectory reflect-curate export failed (scheduler continues)',
      );
      return empty;
    }
  }

  if (!existsSync(packsPath)) return { ...empty, exported, skipped: 'no_packs' };
  const packLines = readFileSync(packsPath, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '');
  if (packLines.length === 0) {
    mkdirSync(reflectDir, { recursive: true });
    writeFileSync(donePath, `${now()}\n`, { flag: 'wx', mode: 0o600 });
    return { ...empty, exported: exported ?? 0, skipped: 'no_packs' };
  }

  mkdirSync(reflectDir, { recursive: true });
  let reflectSummary: ReflectCurateSummary['reflect'] = null;
  if (!existsSync(candidatesPath)) {
    const result = await reflectPacks(packLines, {
      model: deps.model,
      endpoint: deps.endpoint,
      now,
    });
    writeFileSync(candidatesPath, result.lines.length ? `${result.lines.join('\n')}\n` : '', {
      flag: 'wx',
      mode: 0o600,
    });
    reflectSummary = result.summary;
  } else {
    const existing = readFileSync(candidatesPath, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '');
    reflectSummary = {
      reflected: 0,
      notEligible: 0,
      candidates: existing.length,
      rejected: 0,
    };
  }

  const candidateLines = existsSync(candidatesPath)
    ? readFileSync(candidatesPath, 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '')
    : [];
  const beforeGuards = readGuardIds(guardsPath);
  const curateSummary =
    candidateLines.length === 0
      ? {
          memoryPending: 0,
          memoryMerged: 0,
          memoryKnown: 0,
          memoryPromoted: 0,
          guardNew: 0,
          guardMerged: 0,
          skillNew: 0,
          skillMerged: 0,
          rejected: 0,
          buildMissing: 0,
        }
      : curateCandidates(deps.db, candidateLines, {
          skillsDir: deps.config.skillsDir,
          outDir,
        });

  let guardIssuesOpened = 0;
  if (deps.openNewGuards !== undefined) {
    const fresh = readGuards(guardsPath).filter((guard) => !beforeGuards.has(guard.id));
    if (fresh.length > 0) guardIssuesOpened = await deps.openNewGuards(fresh);
  }

  writeFileSync(donePath, `${now()}\n`, { flag: 'wx', mode: 0o600 });
  return {
    date,
    skipped: null,
    exported,
    reflect: reflectSummary,
    curate: curateSummary,
    guardIssuesOpened,
  };
}
