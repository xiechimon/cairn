import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, test } from 'vitest';
import {
  classifySnapshotHits,
  type InjectionClassification,
  reconcileClassificationTotals,
} from '../eval/skills-routing/classify.mts';
import { aggregate, gradeRouting, loadCases } from '../eval/skills-routing/grade.mts';
import { replaySnapshot, scoreRoutingCases } from '../eval/skills-routing/replay.mts';
import { sanitizeSnapshotValue } from '../eval/skills-routing/sanitize.mts';
import {
  assertLiveSourceDb,
  buildSnapshot,
  flattenPopulationHits,
  loadCandidatesFromSkillsDir,
  openSnapshotDatabase,
  readInjectionPopulation,
  type SkillsRoutingSnapshot,
  stratifyHits,
} from '../eval/skills-routing/snapshot.mts';

const temps: string[] = [];

afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'skills-routing-1799-'));
  temps.push(dir);
  return dir;
}

const FIXTURE_CANDIDATES = [
  {
    id: 'aihot',
    name: 'aihot',
    description: 'Automate CI publish and release notes after a deploy',
  },
  {
    id: 'wiki',
    name: 'wiki',
    description: 'Capture decisions into the team wiki',
  },
  {
    id: 'e2e-debugging',
    name: 'e2e-debugging',
    description: 'Debug flaky playwright e2e tests and CI timeouts',
  },
  {
    id: 'design-review',
    name: 'design-review',
    description: 'Review UI layout typography spacing and visual polish',
  },
] as const;

function seedFixtureDb(path: string): void {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE todo (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      spec TEXT NOT NULL
    );
    CREATE TABLE build (
      id TEXT PRIMARY KEY,
      todoId TEXT NOT NULL
    );
    CREATE TABLE step (
      id TEXT PRIMARY KEY,
      buildId TEXT NOT NULL,
      skillInjection TEXT
    );
  `);
  const insertTodo = db.prepare('INSERT INTO todo (id, title, spec) VALUES (?, ?, ?)');
  const insertBuild = db.prepare('INSERT INTO build (id, todoId) VALUES (?, ?)');
  const insertStep = db.prepare('INSERT INTO step (id, buildId, skillInjection) VALUES (?, ?, ?)');
  insertTodo.run('todo-ci', 'fix the CI job', 'The pipeline is red after the last push.');
  insertBuild.run('build-ci', 'todo-ci');
  insertStep.run(
    'step-ci',
    'build-ci',
    JSON.stringify({
      hits: [
        {
          id: 'aihot',
          rule: 'domain',
          reason: '任务文本与技能同域「部署运维」（任务命中「ci」，技能描述命中「发布」）',
        },
      ],
    }),
  );
  insertTodo.run('todo-wiki', 'Use wiki for the decision log', 'Write the ADR outcome into wiki.');
  insertBuild.run('build-wiki', 'todo-wiki');
  insertStep.run(
    'step-wiki',
    'build-wiki',
    JSON.stringify({
      hits: [
        {
          id: 'wiki',
          rule: 'explicit-mention',
          reason: '任务文本显式点名「wiki」',
        },
      ],
    }),
  );
  insertTodo.run(
    'todo-layout',
    'Polish the settings page layout',
    'Tighten spacing without changing behavior.',
  );
  insertBuild.run('build-layout', 'todo-layout');
  insertStep.run(
    'step-layout',
    'build-layout',
    JSON.stringify({
      hits: [
        {
          id: 'design-review',
          rule: 'domain',
          reason: '任务文本与技能同域「前端界面」（任务命中「layout」，技能描述命中「layout」）',
        },
        {
          id: 'e2e-debugging',
          rule: 'domain',
          reason: '任务文本与技能同域「测试」（任务命中「page」，技能描述命中「tests」）',
        },
      ],
    }),
  );
  insertTodo.run('todo-empty', 'Refactor the claim path', 'No skillInjection on this step.');
  insertBuild.run('build-empty', 'todo-empty');
  insertStep.run('step-empty', 'build-empty', null);
  db.close();
}

function seedLargePopulationDb(path: string, stepCount: number, hitsPerStep: number): void {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE todo (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      spec TEXT NOT NULL
    );
    CREATE TABLE build (
      id TEXT PRIMARY KEY,
      todoId TEXT NOT NULL
    );
    CREATE TABLE step (
      id TEXT PRIMARY KEY,
      buildId TEXT NOT NULL,
      skillInjection TEXT
    );
  `);
  const insertTodo = db.prepare('INSERT INTO todo (id, title, spec) VALUES (?, ?, ?)');
  const insertBuild = db.prepare('INSERT INTO build (id, todoId) VALUES (?, ?)');
  const insertStep = db.prepare('INSERT INTO step (id, buildId, skillInjection) VALUES (?, ?, ?)');
  const skills = ['aihot', 'wiki', 'e2e-debugging', 'design-review', 'contributor', 'docs-writer'];
  const rules = ['domain', 'explicit-mention'] as const;
  for (let i = 0; i < stepCount; i++) {
    const todoId = `todo-${i}`;
    const buildId = `build-${i}`;
    const stepId = `step-${i}`;
    insertTodo.run(todoId, `Task title ${i}`, `Task spec body ${i} for skill routing.`);
    insertBuild.run(buildId, todoId);
    const hits = Array.from({ length: hitsPerStep }, (_, j) => ({
      id: skills[(i + j) % skills.length] as string,
      rule: rules[j % rules.length],
      reason: `synthetic hit ${i}/${j}`,
    }));
    insertStep.run(stepId, buildId, JSON.stringify({ hits }));
  }
  db.close();
}

function fixtureSnapshot(): SkillsRoutingSnapshot {
  return {
    snapshotAt: '2026-10-28T00:00:00.000Z',
    sourceDb: '~/.cairn/server/server.db',
    matcherRevision: 'fixture-matcher-revision',
    headRevision: 'fixture-head-revision',
    livePopulation: { stepCount: 3, hitCount: 4 },
    population: { stepCount: 3, hitCount: 4 },
    sampling: {
      method: 'full',
      targetHitCount: null,
      seed: 'fixture',
      sampledHitCount: 4,
      sampledStepCount: 3,
    },
    candidates: [...FIXTURE_CANDIDATES],
    steps: [
      {
        stepId: 'step-ci',
        title: 'fix the CI job',
        spec: 'The pipeline is red after the last push.',
        taskText: 'fix the CI job\n\nThe pipeline is red after the last push.',
        storedHits: [
          {
            id: 'aihot',
            rule: 'domain',
            reason: '任务文本与技能同域「部署运维」（任务命中「ci」，技能描述命中「发布」）',
          },
        ],
      },
      {
        stepId: 'step-wiki',
        title: 'Use wiki for the decision log',
        spec: 'Write the ADR outcome into wiki.',
        taskText: 'Use wiki for the decision log\n\nWrite the ADR outcome into wiki.',
        storedHits: [
          {
            id: 'wiki',
            rule: 'explicit-mention',
            reason: '任务文本显式点名「wiki」',
          },
        ],
      },
      {
        stepId: 'step-layout',
        title: 'Polish the settings page layout',
        spec: 'Tighten spacing without changing behavior.',
        taskText: 'Polish the settings page layout\n\nTighten spacing without changing behavior.',
        storedHits: [
          {
            id: 'design-review',
            rule: 'domain',
            reason: '任务文本与技能同域「前端界面」（任务命中「layout」，技能描述命中「layout」）',
          },
          {
            id: 'e2e-debugging',
            rule: 'domain',
            reason: '任务文本与技能同域「测试」（任务命中「page」，技能描述命中「tests」）',
          },
        ],
      },
    ],
  };
}

describe('skills-routing snapshot and replay (#1967 / #1799)', () => {
  test('replay on a small frozen fixture is deterministic and reproduces the stored hits for the recorded matcher revision', () => {
    const snapshot = fixtureSnapshot();
    const first = replaySnapshot(snapshot);
    const second = replaySnapshot(snapshot);
    expect(second).toEqual(first);
    expect(first.matcherRevision).toBe(snapshot.matcherRevision);
    expect(first.stored.hitCount).toBe(4);
    expect(first.stored.stepCount).toBe(3);
    expect(first.replay.stepCount).toBe(3);
    for (const row of first.rows) {
      expect(row.storedHitIds).toEqual(row.storedHits.map((hit) => hit.id));
      expect(row.predictedHitIds).toEqual(row.predictedHits.map((hit) => hit.id));
    }
    const byStep = Object.fromEntries(first.rows.map((row) => [row.stepId, row]));
    expect(byStep['step-ci']?.storedHitIds).toEqual(['aihot']);
    expect(byStep['step-wiki']?.storedHitIds).toEqual(['wiki']);
    expect(byStep['step-wiki']?.predictedHitIds).toEqual(['wiki']);
    expect(byStep['step-layout']?.storedHitIds).toEqual(['design-review', 'e2e-debugging']);
  });

  test('snapshot opens the database read-only', () => {
    const dir = tempDir();
    const dbPath = join(dir, 'server.db');
    seedFixtureDb(dbPath);
    const sqlite = openSnapshotDatabase(dbPath);
    expect(() =>
      sqlite.exec("INSERT INTO step (id, buildId, skillInjection) VALUES ('x', 'y', null)"),
    ).toThrow(/readonly|read-only|attempt to write/i);
    const population = readInjectionPopulation(sqlite);
    expect(population).toHaveLength(3);
    expect(population.map((row) => row.stepId).sort()).toEqual([
      'step-ci',
      'step-layout',
      'step-wiki',
    ]);
    sqlite.close();
  });

  test('the snapshot contains no secrets or absolute home paths', () => {
    const home = '/home/omarchy-user';
    const dirty = {
      path: `${home}/.cairn/server/server.db`,
      token: 'Bearer abc.def-ghi_jkl',
      nested: {
        note: `see ${home}/secrets/token`,
        github: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      },
    };
    const cleaned = sanitizeSnapshotValue(dirty, { home }) as typeof dirty;
    expect(JSON.stringify(cleaned)).not.toContain(home);
    expect(JSON.stringify(cleaned)).not.toContain('/home/omarchy-user');
    expect(cleaned.path).toBe('~/.cairn/server/server.db');
    expect(cleaned.token).toBe('[REDACTED]');
    expect(cleaned.nested.note).toBe('see ~/secrets/token');
    expect(cleaned.nested.github).toBe('[REDACTED]');
  });

  test('classification totals reconcile with the snapshot population', () => {
    const snapshot = fixtureSnapshot();
    const classifications: InjectionClassification[] = [
      {
        stepId: 'step-ci',
        skillId: 'aihot',
        rule: 'domain',
        label: 'unrelated',
        rationale:
          'Task asks to fix a CI job; aihot is a publish/release helper reached only via the shared deploy keyword ci.',
      },
      {
        stepId: 'step-wiki',
        skillId: 'wiki',
        rule: 'explicit-mention',
        label: 'relevant',
        rationale: 'Task explicitly cues Use wiki for writing the decision log.',
      },
      {
        stepId: 'step-layout',
        skillId: 'design-review',
        rule: 'domain',
        label: 'relevant',
        rationale:
          'Task is a layout polish request; design-review covers layout and spacing review.',
      },
      {
        stepId: 'step-layout',
        skillId: 'e2e-debugging',
        rule: 'domain',
        label: 'uncertain',
        rationale:
          'Stored reason cites a testing-domain bridge that the task text does not clearly support; keep as uncertain rather than force a call.',
      },
    ];
    const totals = reconcileClassificationTotals(snapshot, classifications);
    expect(totals.ok).toBe(true);
    expect(totals.populationHits).toBe(4);
    expect(totals.classifiedHits).toBe(4);
    expect(totals.byLabel).toEqual({ unrelated: 1, relevant: 2, uncertain: 1 });
    expect(classifySnapshotHits(snapshot, classifications)).toHaveLength(4);
  });

  test('documented #1782 baseline command reproduces precision, recall, and forbidden hits on the frozen routing catalog', () => {
    const routingCatalog = [
      {
        id: 'e2e-debugging',
        name: 'e2e-debugging',
        description: 'Debug flaky playwright e2e tests and CI timeouts',
      },
      {
        id: 'design-review',
        name: 'design-review',
        description: 'Review UI layout typography spacing and visual polish',
      },
    ];
    const scored = scoreRoutingCases(loadCases(), routingCatalog);
    expect(aggregate(scored.map((row) => row.score))).toEqual({
      precision: 0.8666666666666667,
      recall: 0.7647058823529411,
      forbiddenHits: 2,
    });
    expect(
      gradeRouting(['e2e-debugging'], ['e2e-debugging'], ['design-review']).forbiddenHits,
    ).toBe(0);
  });

  test('skills-dir loader matches claim-time id and symlink directory rules', () => {
    const dir = tempDir();
    const skillsRoot = join(dir, 'skills');
    mkdirSync(join(skillsRoot, 'dir-aihot'), { recursive: true });
    writeFileSync(
      join(skillsRoot, 'dir-aihot', 'SKILL.md'),
      `---\nname: aihot\ndescription: Automate CI publish and release notes after a deploy\n---\n`,
    );
    mkdirSync(join(skillsRoot, 'wiki'), { recursive: true });
    writeFileSync(
      join(skillsRoot, 'wiki', 'SKILL.md'),
      `---\nname: wiki\ndescription: Capture decisions into the team wiki\n---\n`,
    );
    mkdirSync(join(dir, 'real-dup'), { recursive: true });
    writeFileSync(
      join(dir, 'real-dup', 'SKILL.md'),
      `---\nname: shared-skill\ndescription: Shared via two directory names\n---\n`,
    );
    symlinkSync(join(dir, 'real-dup'), join(skillsRoot, 'alias-a'));
    symlinkSync(join(dir, 'real-dup'), join(skillsRoot, 'alias-b'));
    const candidates = loadCandidatesFromSkillsDir(skillsRoot);
    expect(candidates.map((row) => row.id).sort()).toEqual(['aihot', 'shared-skill', 'wiki']);
    expect(candidates.find((row) => row.id === 'aihot')?.description).toContain('CI publish');
  });

  test('stratified sampling records live population separately from the captured sample', () => {
    const dir = tempDir();
    const dbPath = join(dir, 'server.db');
    seedLargePopulationDb(dbPath, 20, 6);
    const sqlite = openSnapshotDatabase(dbPath);
    const flat = flattenPopulationHits(readInjectionPopulation(sqlite));
    sqlite.close();
    expect(flat).toHaveLength(120);
    const sample = stratifyHits(flat, 30, 'unit-seed');
    expect(sample).toHaveLength(30);
    const again = stratifyHits(flat, 30, 'unit-seed');
    expect(again).toEqual(sample);
    const snapshot = buildSnapshot({
      dbPath,
      candidates: [...FIXTURE_CANDIDATES],
      repoRoot: join(import.meta.dirname, '../..'),
      stratifyHitCount: 30,
      sampleSeed: 'unit-seed',
      snapshotAt: '2026-10-28T18:00:00.000Z',
      home: dir,
    });
    expect(snapshot.livePopulation).toEqual({ stepCount: 20, hitCount: 120 });
    expect(snapshot.population.hitCount).toBe(30);
    expect(snapshot.sampling.method).toBe('stratified-by-rule-skill');
    expect(snapshot.sourceDb.endsWith('server.db')).toBe(true);
    expect(snapshot.sourceDb.startsWith('fixture://')).toBe(false);
  });
});

describe('skills-routing committed baseline artifacts (#1967 / #1799)', () => {
  const root = join(import.meta.dirname, '../../docs/verify/1799');
  const snapshotPath = join(root, 'snapshot.json');
  const classificationPath = join(root, 'classification.json');
  const hasLiveCapture = existsSync(snapshotPath) && existsSync(classificationPath);

  test.skipIf(!hasLiveCapture)(
    'docs/verify/1799 snapshot and classification stay reconciled against a live server.db capture',
    () => {
      const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as SkillsRoutingSnapshot;
      assertLiveSourceDb(snapshot.sourceDb);
      expect(snapshot.livePopulation.stepCount).toBeGreaterThan(0);
      expect(snapshot.livePopulation.hitCount).toBeGreaterThanOrEqual(snapshot.population.hitCount);
      expect(snapshot.population.hitCount).toBeGreaterThan(0);
      const classifications = JSON.parse(
        readFileSync(classificationPath, 'utf8'),
      ) as InjectionClassification[];
      const totals = reconcileClassificationTotals(snapshot, classifications);
      expect(totals.ok).toBe(true);
      expect(totals.populationHits).toBe(snapshot.population.hitCount);
      expect(totals.classifiedHits).toBe(snapshot.population.hitCount);
      const replay = replaySnapshot(snapshot);
      expect(replay.stored.hitCount).toBe(snapshot.population.hitCount);
      expect(replay.rows).toHaveLength(snapshot.population.stepCount);
    },
  );

  test('docs/verify/1799 documents the live capture command and rejects fixture sourceDb markers', () => {
    const readme = readFileSync(join(root, 'README.md'), 'utf8');
    expect(readme).toContain('docs/verify/1799/snapshot.json');
    expect(readme).toContain('~/.cairn/server/server.db');
    expect(readme).toContain('--stratify-hits');
    expect(() => assertLiveSourceDb('fixture://docs/verify/1799')).toThrow(/live DB path/);
    expect(() => assertLiveSourceDb('~/.cairn/server/server.db')).not.toThrow();
  });

  test('when ~/.cairn/server/server.db is present the committed capture must measure that live population', () => {
    const liveDb = join(process.env.HOME ?? '', '.cairn/server/server.db');
    if (!existsSync(liveDb)) return;
    expect(hasLiveCapture).toBe(true);
    const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as SkillsRoutingSnapshot;
    assertLiveSourceDb(snapshot.sourceDb);
    const sqlite = openSnapshotDatabase(liveDb);
    try {
      const liveHits = flattenPopulationHits(readInjectionPopulation(sqlite));
      const liveSteps = new Set(liveHits.map((row) => row.stepId));
      expect(snapshot.livePopulation).toEqual({
        stepCount: liveSteps.size,
        hitCount: liveHits.length,
      });
    } finally {
      sqlite.close();
    }
  });
});
