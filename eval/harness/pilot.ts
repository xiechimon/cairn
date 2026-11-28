import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { journeyPassed } from '../scorers/journey-checks.js';
import { type CliModel, cliModelFromEnv, runCliCase } from './cli-arm.js';
import { type JourneyArm, runJourneyTask } from './journey.js';
import { type Decision, decide, discordance, type Pair, powerAt } from './paired.js';
import { ReservationLedger } from './reserve.js';
import { writeScorecard } from './scorecard.js';
import { type BrokeredModel, brokeredModelFromEnv } from './script.js';
import type { JourneyTask, ScriptStep } from './types.js';

export const CALIBRATION_CAP = { maxStarts: 64, maxWallMinutes: 30 };

const CASE_FAMILIES = [
  {
    id: 'sum',
    title: '修好求和',
    file: 'src/sum.mjs',
    broken: 'export const add = (a, b) => a - b;\n',
    fixed: 'export const add = (a, b) => a + b;\n',
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
    broken: 'export const slug = (s) => s;\n',
    fixed: "export const slug = (s) => s.trim().toLowerCase().replace(/\\s+/g, '-');\n",
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
    fixed: 'export const parse = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);\n',
    test: [
      "import { test } from 'node:test';",
      "import assert from 'node:assert/strict';",
      "import { parse } from '../src/parse.mjs';",
      "test('parse', () => assert.equal(parse('nope'), null));",
      '',
    ].join('\n'),
  },
  {
    id: 'capitalize',
    title: '修好首字母大写',
    file: 'src/capitalize.mjs',
    broken: 'export const capitalize = (s) => s;\n',
    fixed: 'export const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);\n',
    test: [
      "import { test } from 'node:test';",
      "import assert from 'node:assert/strict';",
      "import { capitalize } from '../src/capitalize.mjs';",
      "test('capitalize', () => assert.equal(capitalize('hello'), 'Hello'));",
      '',
    ].join('\n'),
  },
  {
    id: 'clamp',
    title: '修好 clamp',
    file: 'src/clamp.mjs',
    broken: 'export const clamp = (n) => n;\n',
    fixed: 'export const clamp = (n) => Math.min(10, Math.max(0, n));\n',
    test: [
      "import { test } from 'node:test';",
      "import assert from 'node:assert/strict';",
      "import { clamp } from '../src/clamp.mjs';",
      "test('clamp', () => assert.equal(clamp(-1), 0));",
      '',
    ].join('\n'),
  },
  {
    id: 'unique',
    title: '修好去重',
    file: 'src/unique.mjs',
    broken: 'export const unique = (xs) => xs;\n',
    fixed: 'export const unique = (xs) => [...new Set(xs)];\n',
    test: [
      "import { test } from 'node:test';",
      "import assert from 'node:assert/strict';",
      "import { unique } from '../src/unique.mjs';",
      "test('unique', () => assert.deepEqual(unique([1, 1, 2]), [1, 2]));",
      '',
    ].join('\n'),
  },
  {
    id: 'count',
    title: '修好计数',
    file: 'src/count.mjs',
    broken: 'export const count = (s, ch) => 0;\n',
    fixed: 'export const count = (s, ch) => s.split(ch).length - 1;\n',
    test: [
      "import { test } from 'node:test';",
      "import assert from 'node:assert/strict';",
      "import { count } from '../src/count.mjs';",
      "test('count', () => assert.equal(count('aba', 'a'), 2));",
      '',
    ].join('\n'),
  },
  {
    id: 'trim',
    title: '修好去空格',
    file: 'src/trim.mjs',
    broken: 'export const trim = (s) => s;\n',
    fixed: 'export const trim = (s) => s.trim();\n',
    test: [
      "import { test } from 'node:test';",
      "import assert from 'node:assert/strict';",
      "import { trim } from '../src/trim.mjs';",
      "test('trim', () => assert.equal(trim(' x '), 'x'));",
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
    [
      '-c',
      'user.email=eval@cairn.dev',
      '-c',
      'user.name=eval',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
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
      files: [],
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

export interface LaunchRow {
  caseId: string;
  arm: JourneyArm;
  wallMs: number;
  passed: boolean;
  exitCode: number | null;
}

export interface PilotResult {
  topic: string;
  mode: 'scripted' | 'cli' | 'brokered';
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
  launches: LaunchRow[];
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

type PilotModel =
  | { kind: 'scripted' }
  | { kind: 'cli'; config: CliModel }
  | { kind: 'brokered'; config: BrokeredModel };

interface ArmRun {
  arm: JourneyArm;
  outcomes: Map<string, boolean>;
  launches: LaunchRow[];
}

async function runArm(
  cases: readonly PilotCase[],
  arm: JourneyArm,
  ledger: ReservationLedger,
  model: PilotModel,
): Promise<ArmRun> {
  const outcomes = new Map<string, boolean>();
  const launches: LaunchRow[] = [];
  for (const item of cases) {
    const started = Date.now();
    const reserve = model.kind === 'cli' ? arm !== 'nopatch' : true;
    const reservation = reserve ? ledger.open(`${arm}/${item.task.id}`, started) : null;
    if (reservation !== null && !reservation.ok) {
      outcomes.set(item.task.id, false);
      continue;
    }
    try {
      let passed = false;
      if (model.kind === 'cli') {
        const result = await runCliCase(item.task, {
          repoRoot: item.repoRoot,
          model: model.config,
          launch: arm !== 'nopatch',
        });
        passed = result.passed;
        if (result.launch !== undefined)
          launches.push({
            caseId: item.task.id,
            arm,
            wallMs: result.launch.wallMs,
            passed: result.passed,
            exitCode: result.launch.exitCode,
          });
      } else {
        const journeyOptions =
          model.kind === 'brokered'
            ? { repoRoot: item.repoRoot, arm, model: 'brokered' as const, brokered: model.config }
            : { repoRoot: item.repoRoot, arm };
        const result = await runJourneyTask(item.task, journeyOptions);
        passed = result.record.incomplete === undefined && journeyPassed(item.task, result.record);
      }
      outcomes.set(item.task.id, passed);
    } finally {
      if (reservation?.ok) ledger.charge(reservation.id, Date.now() - started);
    }
  }
  return { arm, outcomes, launches };
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
        rows.push({
          pairs,
          discordance: d,
          candidateShare: share,
          power: powerAt(pairs, d, share),
        });
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

export interface PilotOptions {
  /** Runs the approved model behind its own CLI; the scripted arm is chosen when absent. */
  cli?: CliModel | null;
  brokered?: BrokeredModel | null;
  cases?: number;
}

function pilotModel(options: PilotOptions): PilotModel {
  const cli = options.cli === undefined ? cliModelFromEnv() : options.cli;
  if (cli !== null) return { kind: 'cli', config: cli };
  const brokered = options.brokered === undefined ? brokeredModelFromEnv() : options.brokered;
  return brokered === null ? { kind: 'scripted' } : { kind: 'brokered', config: brokered };
}

export async function runPilot(options: PilotOptions = {}): Promise<PilotResult> {
  const startedAt = new Date().toISOString();
  const model = pilotModel(options);
  const families = CASE_FAMILIES.slice(0, options.cases ?? CASE_FAMILIES.length);
  const cases = families.map((family) => makeCase(family));
  const ledger = new ReservationLedger(CALIBRATION_CAP);
  const arms: ArmSummary[] = [];
  const launches: LaunchRow[] = [];
  let aa: Decision = decide([]);
  let damage: Decision = decide([]);
  let aaDiscordance = 0;
  try {
    const first = await runArm(cases, 'none', ledger, model);
    const second = await runArm(cases, 'none', ledger, model);
    const control = await runArm(cases, 'nopatch', ledger, model);
    for (const run of [first, second, control]) {
      arms.push({
        arm: run.arm,
        passed: [...run.outcomes.values()].filter(Boolean).length,
        graded: run.outcomes.size,
      });
      launches.push(...run.launches);
    }
    const aaPairs = toPairs(first.outcomes, second.outcomes);
    aaDiscordance = discordance(aaPairs);
    aa = decide(aaPairs);
    damage = decide(toPairs(first.outcomes, control.outcomes));
    const snapshot = ledger.snapshot();
    const conclusion =
      model.kind === 'scripted'
        ? 'Machinery only: scripted arms carry no model noise, so this measures the harness, the cap and the decision rule, not the model.'
        : model.kind === 'cli'
          ? 'The approved model ran each case as its own agent in a runner-shaped checkout; a separate grader took only the allowed patch and ran the hidden test.'
          : 'Paired decision measured on the approved model through its chat endpoint.';
    return {
      topic: 'harness-self-improve',
      mode: model.kind,
      model:
        model.kind === 'cli'
          ? model.config.modelId
          : model.kind === 'brokered'
            ? model.config.modelId
            : 'stub/m',
      startedAt,
      finishedAt: new Date().toISOString(),
      wallMs: snapshot.wallMs,
      cap: CALIBRATION_CAP,
      starts: snapshot.starts,
      stopReason: snapshot.stopReason,
      capProof: capProof(CALIBRATION_CAP),
      cases: cases.length,
      arms,
      launches,
      aa,
      damage,
      aaDiscordance,
      power: powerProfile(),
      conclusion,
      missing:
        model.kind === 'scripted'
          ? 'A real-model arm needs the approved model behind EVAL_ARM_CLI/EVAL_ARM_MODEL_ID (CLI) or EVAL_ARM_BASE_URL/EVAL_ARM_MODEL/EVAL_ARM_API_KEY (endpoint); none is provisioned in this environment.'
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
  const card = arg('scorecard');
  const limit = arg('cases');
  const result = await runPilot(limit === undefined ? {} : { cases: Number(limit) });
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
  if (card !== undefined) writeScorecard(card, result);
  console.log(
    `pilot: ${result.mode}, ${result.starts} starts, ${result.cases} cases -> ${out}${card === undefined ? '' : ` + ${card}`}`,
  );
}
