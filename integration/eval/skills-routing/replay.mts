import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { type SkillInjectCandidate, type SkillInjectHit, selectSkillsForTask } from '@cairn/shared';
import {
  aggregate,
  gradeRouting,
  loadCases,
  type RoutingScore,
  type SkillsRoutingCase,
} from './grade.mts';
import type { SkillsRoutingSnapshot } from './snapshot.mts';

export interface ReplayRow {
  stepId: string;
  taskText: string;
  storedHits: SkillInjectHit[];
  storedHitIds: string[];
  predictedHits: SkillInjectHit[];
  predictedHitIds: string[];
}

export interface ReplayReport {
  matcherRevision: string;
  headRevision: string;
  stored: { stepCount: number; hitCount: number };
  replay: { stepCount: number; hitCount: number };
  rows: ReplayRow[];
}

export interface RoutingCaseScore {
  id: string;
  task: string;
  predicted: string[];
  expected: string[];
  forbidden: string[];
  score: RoutingScore;
}

export function replaySnapshot(snapshot: SkillsRoutingSnapshot): ReplayReport {
  const rows: ReplayRow[] = snapshot.steps.map((step) => {
    const predictedHits = selectSkillsForTask(step.taskText, snapshot.candidates);
    return {
      stepId: step.stepId,
      taskText: step.taskText,
      storedHits: step.storedHits,
      storedHitIds: step.storedHits.map((hit) => hit.id),
      predictedHits,
      predictedHitIds: predictedHits.map((hit) => hit.id),
    };
  });
  return {
    matcherRevision: snapshot.matcherRevision,
    headRevision: snapshot.headRevision,
    stored: {
      stepCount: snapshot.population.stepCount,
      hitCount: snapshot.population.hitCount,
    },
    replay: {
      stepCount: rows.length,
      hitCount: rows.reduce((sum, row) => sum + row.predictedHits.length, 0),
    },
    rows,
  };
}

export function scoreRoutingCases(
  cases: readonly SkillsRoutingCase[],
  candidates: readonly SkillInjectCandidate[],
): RoutingCaseScore[] {
  return cases.map((routingCase) => {
    const predicted = selectSkillsForTask(routingCase.task, candidates).map((hit) => hit.id);
    return {
      id: routingCase.id,
      task: routingCase.task,
      predicted,
      expected: routingCase.expected,
      forbidden: routingCase.forbidden,
      score: gradeRouting(predicted, routingCase.expected, routingCase.forbidden),
    };
  });
}

function printHelp(): void {
  process.stdout.write(`Usage:
  pnpm exec tsx integration/eval/skills-routing/replay.mts --snapshot <snapshot.json> [--routing-catalog <catalog.json>]
`);
}

function parseArgs(argv: string[]): {
  snapshot?: string;
  routingCatalog?: string;
  help: boolean;
} {
  const out: { snapshot?: string; routingCatalog?: string; help: boolean } = { help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg === '--snapshot') out.snapshot = argv[++i];
    else if (arg === '--routing-catalog') out.routingCatalog = argv[++i];
    else throw new Error(`unknown argument: ${arg}`);
  }
  return out;
}

function loadSnapshot(path: string): SkillsRoutingSnapshot {
  return JSON.parse(readFileSync(path, 'utf8')) as SkillsRoutingSnapshot;
}

function loadCatalog(path: string): SkillInjectCandidate[] {
  return JSON.parse(readFileSync(path, 'utf8')) as SkillInjectCandidate[];
}

export function main(argv: string[]): number {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }
  if (args.snapshot === undefined) {
    printHelp();
    return 1;
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const snapshot = loadSnapshot(resolve(args.snapshot));
  const historical = replaySnapshot(snapshot);
  const routingCatalogPath =
    args.routingCatalog ?? join(here, '../../../docs/verify/1967/routing-catalog.json');
  const routingCatalog = loadCatalog(routingCatalogPath);
  const routingScores = scoreRoutingCases(loadCases(), routingCatalog);
  const totals = aggregate(routingScores.map((row) => row.score));
  process.stdout.write(
    `${JSON.stringify(
      {
        historicalStored: historical.stored,
        historicalReplayPredictions: {
          stepCount: historical.replay.stepCount,
          hitCount: historical.replay.hitCount,
          note: 'Replay predictions use selectSkillsForTask on frozen task text and frozen candidates; they are reported separately from stored hits.',
        },
        matcherRevision: historical.matcherRevision,
        routing1782: {
          catalog: routingCatalogPath,
          totals,
        },
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
