import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { journeyPassed } from '../scorers/journey-checks.js';
import { runJourneyTask, type JourneyArm } from './journey.js';
import { decide, discordance, powerAt, type Decision, type Pair } from './paired.js';
import { ReservationLedger } from './reserve.js';
import { brokeredModelFromEnv, type BrokeredModel } from './script.js';
import type { JourneyTask, ScriptStep } from './types.js';

export const CALIBRATION_CAP = { maxStarts: 64, maxWallMinutes: 30 };

const CASE_FAMILIES = [
  {
    id: 'sum',
    title: '修好求和',
    file: 'src/sum.mjs',
    broken: 'export const add = (a, b) => a - b;\n',
    fixed: 'export const add = (a, b) => a + b;\n',
    check: 'a + b',
    test: [
      "import { test } from 'node:test';",
      "import assert from 'node:assert/strict';",
      "import { add } from '../src/sum.mjs';",
      "test('adds', () => assert.equal(add(2, 3), 5));",
      '',
    ].join('\n'),
  },
  {
    id: 'slug',
    title: '修好 slug',
    file: 'src/slug.mjs',
    broken: "export const slug = (s) => s;\n",
    fixed: "export const slug = (s) => s.trim().toLowerCase().replace(/\\s+/g, '-');\n",
    check: "replace(/\\\\s+/g, '-')",
    test: [
      "import { test } from 'node:test';",
      "import assert from 'node:assert/strict';",
      "import { slug } from '../src/slug.mjs';",
      "test('slug', () => assert.equal(slug(' A  b '), 'a-b'));",
      '',
    ].join('\n'),
  },
  {
    id: 'parse',
    title: '修好 parse',
    file: 'src/parse.mjs',
    broken: 'export const parse = (v) => Number(v);\n',
    fixed: "export const parse = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);\n",
    check: 'isFinite',
    test: [
      "import { test } from 'node:test';",
      "import assert from 'node:assert/strict';",
      "import { parse } from '../src/parse.mjs';",
      "test('parse', () => assert.equal(parse('nope'), null));",
      '',
    ].join('\n'),
  },
] as const;

interface PilotCase {
  task: JourneyTask;
  repoRoot: string;
}

const tempRoots: string[] = [];

function git(cwd: string, args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.email=eval@cairn.dev', '-c', 'user.name=eval', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8' },
  ).trim();
}

function makeCase(family: (typeof CASE_FAMILIES)[number]): PilotCase {
  const repoRoot = mkdtempSync(join(tmpdir(), `pilot-${family.id}-`));
  tempRoots.push(repoRoot);
  git(repoRoot, ['init', '-q']);
  mkdirSync(join(repoRoot, 'src'), { recursive: true });
  writeFileSync(join(repoRoot, family.file), family.broken);
  git(repoRoot, ['add', '-A']);
  git(repoRoot, ['commit', '-qm', 'parent']);
  const parentCommit = git(repoRoot, ['rev-parse', 'HEAD']);
  writeFileSync(join(repoRoot, family.file), family.fixed);
  mkdirSync(join(repoRoot, 'test'), { recursive: true });
  writeFileSync(join(repoRoot, 'test', `${family.id}.test.mjs`), family.test);
  git(repoRoot, ['add', '-A']);
  git(repoRoot, ['commit', '-qm', 'fix']);
  const fixCommit = git(repoRoot, ['rev-parse', 'HEAD']);
  const request = `demo 项目的 ${family.id} 算错了，修一下并跑测试`;
  const script: ScriptStep[] = [
    {
      toolCalls: [
        {
          name: 'create_todo',
          args: { projectId: '@demo', title: family.title, quotes: [request] },
        },
      ],
    },
    { text: '已交给 runner。' },
  ];
  const task: JourneyTask = {
    kind: 'journey',
    id: `pilot-${family.id}`,
    request,
    world: { projects: ['demo'], todos: [] },
    script,
    expected: { decision: 'route', projects: ['demo'], promptContains: [], promptExcludes: [] },
    source: {
      parentCommit,
      fixCommit,
      testFiles: [`test/${family.id}.test.mjs`],
      existingTestFiles: [],
    },
    checks: {
      files: [{ path: family.file, contains: family.check }],
      commands: [`node --test test/${family.id}.test.mjs`],
    },
    gate: true,
  };
  return { task, repoRoot };
}

export interface ArmSummary {
  arm: JourneyArm;
  passed: number;
  graded: number;
}

export interface ScenarioRow {
  pairs: number;
  discordance: number;
  candidateShare: number;
  power: number;
}

export interface PilotResult {
  topic: string;
  mode: 'scripted' | 'brokered';
  model: string;
  startedAt: string;
  finishedAt: string;
  wallMs: number;
  cap: { maxStarts: number; maxWallMinutes: number };
  starts: number;
  stopReason: string | null;
  capProof: { attempted: number; admitted: number; refused: string };
  cases: number;
  arms: ArmSummary[];
  aa: Decision;
  damage: Decision;
  aaDiscordance: number;
  power: {
    targetPoints: number;
    confirmationPairs: number;
    atReference: number;
    scenarios: ScenarioRow[];
    reach80: { pairs: number; discordance: number } | null;
  };
  conclusion: string;
  missing: string | null;
}

async function runArm(
  cases: readonly PilotCase[],
  arm: JourneyArm,
  ledger: ReservationLedger,
  model: { kind: 'scripted' } | { kind: 'brokered'; config: BrokeredModel },
): Promise<{ arm: JourneyArm; outcomes: Map<string, boolean> }> {
  const outcomes = new Map<string, boolean>();
  for (const item of cases) {
    const started = Date.now();
    const reservation = ledger.open(`${arm}/${item.task.id}`, started);
    if (!reservation.ok) {
      outcomes.set(item.task.id, false);
      continue;
    }
    const options =
      model.kind === 'brokered'
        ? { repoRoot: item.repoRoot, arm, model: 'brokered' as const, brokered: model.config }
        : { repoRoot: item.repoRoot, arm };
    try {
      const result = await runJourneyTask(item.task, options);
      outcomes.set(item.task.id, result.record.incomplete === undefined && journeyPassed(item.task, result.record));
    } finally {
      ledger.charge(reservation.id, Date.now() - started);
    }
  }
  return { arm, outcomes };
}

function toPairs(baseline: Map<string, boolean>, candidate: Map<string, boolean>): Pair[] {
  const pairs: Pair[] = [];
  for (const [caseId, value] of baseline) {
    const other = candidate.get(caseId);
    if (other === undefined) continue;
    pairs.push({ caseId, baseline: value, candidate: other });
  }
  return pairs;
}

function capProof(cap: { maxStarts: number; maxWallMinutes: number }): PilotResult['capProof'] {
  const ledger = new ReservationLedger(cap);
  let admitted = 0;
  let refused = '';
  for (let i = 0; i <= cap.maxStarts; i += 1) {
    const reservation = ledger.open('cap-proof');
    if (!reservation.ok) {
      refused = reservation.reason;
      break;
    }
    admitted += 1;
    if (reservation.ok) ledger.charge(reservation.id, 0);
  }
  return { attempted: admitted + 1, admitted, refused };
}

function powerProfile(): PilotResult['power'] {
  const rows: ScenarioRow[] = [];
  for (const pairs of [24, 32, 40, 48]) {
    for (const d of [0.3, 0.5, 0.8]) {
      for (const share of [0.65, 0.8]) {
        rows.push({ pairs, discordance: d, candidateShare: share, power: powerAt(pairs, d, share) });
      }
    }
  }
  let reach: { pairs: number; discordance: number } | null = null;
  for (let pairs = 24; pairs <= 200 && reach === null; pairs += 2) {
    for (const d of [1, 0.8, 0.5]) {
      if (powerAt(pairs, d, 1) >= 0.8) {
        reach = { pairs, discordance: d };
        break;
      }
    }
  }
  return {
    targetPoints: 30,
    confirmationPairs: 24,
    atReference: powerAt(24, 1, 0.65),
    scenarios: rows,
    reach80: reach,
  };
}

export async function runPilot(
  options: { brokered?: BrokeredModel | null; cases?: number } = {},
): Promise<PilotResult> {
  const startedAt = new Date().toISOString();
  const brokered = options.brokered === undefined ? brokeredModelFromEnv() : options.brokered;
  const families = CASE_FAMILIES.slice(0, options.cases ?? CASE_FAMILIES.length);
  const cases = families.map((family) => makeCase(family));
  const ledger = new ReservationLedger(CALIBRATION_CAP);
  const arms: ArmSummary[] = [];
  let aa: Decision = decide([]);
  let damage: Decision = decide([]);
  let aaDiscordance = 0;
  try {
    const model =
      brokered === null ? ({ kind: 'scripted' } as const) : ({ kind: 'brokered', config: brokered } as const);
    const first = await runArm(cases, 'none', ledger, model);
    const second = await runArm(cases, 'none', ledger, model);
    const control = await runArm(cases, 'nopatch', ledger, model);
    for (const run of [first, second, control]) {
      arms.push({
        arm: run.arm,
        passed: [...run.outcomes.values()].filter(Boolean).length,
        graded: run.outcomes.size,
      });
    }
    const aaPairs = toPairs(first.outcomes, second.outcomes);
    aaDiscordance = discordance(aaPairs);
    aa = decide(aaPairs);
    damage = decide(toPairs(first.outcomes, control.outcomes));
    const snapshot = ledger.snapshot();
    const mode = model.kind === 'brokered' ? 'brokered' : 'scripted';
    const conclusion =
      mode === 'scripted'
        ? 'Machinery only: scripted arms carry no model noise, so this measures the harness, the cap and the decision rule, not the model.'
        : 'Paired decision measured on the approved model.';
    return {
      topic: 'harness-self-improve',
      mode,
      model: model.kind === 'brokered' ? brokered?.modelId ?? '' : 'stub/m',
      startedAt,
      finishedAt: new Date().toISOString(),
      wallMs: snapshot.wallMs,
      cap: CALIBRATION_CAP,
      starts: snapshot.starts,
      stopReason: snapshot.stopReason,
      capProof: capProof(CALIBRATION_CAP),
      cases: cases.length,
      arms,
      aa,
      damage,
      aaDiscordance,
      power: powerProfile(),
      conclusion,
      missing:
        mode === 'scripted'
          ? 'A real-model A/A needs the approved model behind EVAL_ARM_BASE_URL/EVAL_ARM_MODEL/EVAL_ARM_API_KEY; none is provisioned in this environment.'
          : null,
    };
  } finally {
    for (const dir of tempRoots.splice(0)) rmSync(dir, { recursive: true, force: true });
  }
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = arg('out') ?? join('eval', 'pilot-result.json');
  const result = await runPilot();
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`pilot: ${result.mode}, ${result.starts} starts, ${result.cases} cases -> ${out}`);
}
