import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  dependencyImpact,
  LIVE_SERVER,
  listSpecs,
  parseYamlDocuments,
  selectSpecs,
  workspacePackages,
} from './e2e-affected-select.mjs';
import { mergeWeights, parseWeights } from './e2e-shard-weights.mjs';
import { partitionByWeight } from './timed-partition.mjs';

const LOCKFILE = `---
lockfileVersion: '9.0'

importers:

  .:
    packageManagerDependencies:
      pnpm:
        specifier: 12.5.1
        version: 12.5.1

packages:

  pnpm@12.5.1:
    resolution: {integrity: sha512-pnpm}

snapshots:

  pnpm@12.5.1: {}

---
lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:

  .:
    devDependencies:
      '@biomejs/biome':
        specifier: 'catalog:'
        version: 2.5.14

  apps/daemon:
    dependencies:
      ws:
        specifier: ^8.0.0
        version: 8.18.0

  apps/server:
    dependencies:
      '@cairn/shared':
        specifier: workspace:*
        version: link:../../packages/shared
      better-sqlite3:
        specifier: 13.0.3
        version: 13.0.3

  apps/web:
    dependencies:
      '@cairn/shared':
        specifier: workspace:*
        version: link:../../packages/shared
      react-dom:
        specifier: 'catalog:'
        version: 19.3.0(react@19.3.0)
    devDependencies:
      vite:
        specifier: 'catalog:'
        version: 8.3.0

  packages/shared:
    dependencies:
      zod:
        specifier: 'catalog:'
        version: 4.6.5

packages:

  '@biomejs/biome@2.5.14':
    resolution: {integrity: sha512-biome}

  better-sqlite3@13.0.3:
    resolution: {integrity: sha512-sqlite}

  esbuild@0.27.0:
    resolution: {integrity: sha512-esbuild}
    hasBin: true

  react-dom@19.3.0:
    resolution: {integrity: sha512-react-dom}
    peerDependencies:
      react: ^19.3.0

  react@19.3.0:
    resolution: {integrity: sha512-react}

  scheduler@0.27.0:
    resolution: {integrity: sha512-scheduler}

  vite@8.3.0:
    resolution: {integrity: sha512-vite}
    os: [linux, darwin]

  ws@8.18.0:
    resolution: {integrity: sha512-ws}

  zod@4.6.5:
    resolution: {integrity: sha512-zod}

snapshots:

  '@biomejs/biome@2.5.14': {}

  better-sqlite3@13.0.3: {}

  esbuild@0.27.0: {}

  react-dom@19.3.0(react@19.3.0):
    dependencies:
      react: 19.3.0
      scheduler: 0.27.0

  react@19.3.0: {}

  scheduler@0.27.0: {}

  vite@8.3.0:
    dependencies:
      esbuild: 0.27.0
    optionalDependencies:
      fsevents: 2.3.3

  fsevents@2.3.3:
    optional: true

  ws@8.18.0: {}

  zod@4.6.5: {}
`;

const WORKSPACE = `packages:
  - apps/*
  - packages/*

allowBuilds:
  better-sqlite3: true
  esbuild: true

catalog:
  react: 19.3.0
`;

const unchanged = { lockfile: LOCKFILE, workspace: WORKSPACE };
const impact = (head, base = unchanged) =>
  dependencyImpact({ base, head: { ...unchanged, ...head } });
const lockfileWith = (from, to) => {
  assert.ok(LOCKFILE.includes(from), `fixture lacks ${from}`);
  return { lockfile: LOCKFILE.replaceAll(from, to) };
};
const workspaceWith = (from, to) => {
  assert.ok(WORKSPACE.includes(from), `fixture lacks ${from}`);
  return { workspace: WORKSPACE.replace(from, to) };
};

const ALL_SPECS = [
  'a11y-axe.spec.ts',
  'board-shell.spec.ts',
  'card-chip.spec.ts',
  'gallery-snapshots.spec.ts',
  'live-server-boot.spec.ts',
  'paper-card-row.spec.ts',
  'texture-grain.spec.ts',
  'token-gate.spec.ts',
];
const select = (
  paths,
  dependencies = () => assert.fail('dependencies read without cause'),
  lockfile = LOCKFILE,
) =>
  selectSpecs({
    paths,
    allSpecs: ALL_SPECS,
    dependencies,
    workspace: () => workspacePackages(lockfile),
  });
const SERVER_ONLY_PACKAGE = `${LOCKFILE.replace(
  '      better-sqlite3:\n        specifier: 13.0.3',
  "      '@cairn/store':\n        specifier: workspace:*\n        version: link:../../packages/store\n      better-sqlite3:\n        specifier: 13.0.3",
).replace(
  '\n  packages/shared:\n',
  "\n  packages/shared-docs: {}\n\n  packages/store:\n    dependencies:\n      '@cairn/deep':\n        specifier: workspace:*\n        version: link:../deep\n\n  packages/deep: {}\n\n  packages/shared:\n",
)}`;

test('a build permission change on a package only the live server installs runs the live-server specs', () => {
  const result = impact(workspaceWith('better-sqlite3: true', 'better-sqlite3: false'));
  assert.deepEqual(result.specs, LIVE_SERVER);
  assert.match(result.why, /better-sqlite3/);
});

test('a build permission change on a package the web build installs runs everything', () => {
  assert.equal(impact(workspaceWith('esbuild: true', 'esbuild: false')).specs, null);
});

test('a build setting written as a flow map or list is read like a block one', () => {
  const inline = (sqlite) => ({
    workspace: WORKSPACE.replace(
      'allowBuilds:\n  better-sqlite3: true\n  esbuild: true\n',
      `allowBuilds: {better-sqlite3: ${sqlite}, esbuild: true}\n`,
    ),
  });
  assert.notEqual(inline(true).workspace, WORKSPACE);
  assert.deepEqual(
    impact(inline(false), { lockfile: LOCKFILE, ...inline(true) }).specs,
    LIVE_SERVER,
  );
  assert.equal(impact({ workspace: `${WORKSPACE}onlyBuiltDependencies: [esbuild]\n` }).specs, null);
  assert.equal(impact({ workspace: `${WORKSPACE}onlyBuiltDependencies: esbuild\n` }).specs, null);
});

test('a workspace edit that resolves no different package selects nothing', () => {
  assert.deepEqual(
    impact(workspaceWith('  - packages/*\n', '  - packages/*\n  - site\n')).specs,
    [],
  );
  assert.deepEqual(impact(unchanged).specs, []);
});

test('a workspace setting that can change how packages are laid out runs everything', () => {
  for (const setting of [
    'nodeLinker: hoisted\n',
    'shamefullyHoist: true\n',
    'publicHoistPattern:\n  - "*"\n',
  ]) {
    const result = impact({ workspace: WORKSPACE + setting });
    assert.equal(result.specs, null, setting);
  }
});

test('a lockfile bump inside the web closure runs everything, transitive and through a workspace link', () => {
  assert.equal(
    impact(lockfileWith('scheduler@0.27.0', 'scheduler@0.28.0')).specs,
    null,
    'transitive',
  );
  assert.equal(impact(lockfileWith('sha512-zod', 'sha512-zod-2')).specs, null, 'via link:');
  assert.equal(
    impact(lockfileWith('sha512-biome', 'sha512-biome-2')).specs,
    null,
    'root toolchain',
  );
  assert.equal(
    impact(
      lockfileWith(
        '    optionalDependencies:\n      fsevents',
        '    dependencies:\n      fsevents',
      ),
    ).specs,
    null,
    'dependency kind',
  );
});

test('a lockfile bump only the live server installs runs the live-server specs', () => {
  assert.deepEqual(impact(lockfileWith('sha512-sqlite', 'sha512-sqlite-2')).specs, LIVE_SERVER);
});

test('a lockfile bump neither the web app nor the live server installs selects nothing', () => {
  assert.deepEqual(impact(lockfileWith('8.18.0', '8.19.0')).specs, []);
});

test('a lockfile setting change runs everything', () => {
  assert.equal(
    impact(lockfileWith('autoInstallPeers: true', 'autoInstallPeers: false')).specs,
    null,
  );
  assert.equal(
    impact({
      lockfile: LOCKFILE.replace(
        '\nimporters:\n\n  .:\n    devDependencies',
        '\noverrides:\n  ws: 8.0.0\n\nimporters:\n\n  .:\n    devDependencies',
      ),
    }).specs,
    null,
  );
});

test('an unreadable or unparseable dependency state runs everything', () => {
  assert.equal(
    impact(unchanged, { lockfile: null, workspace: WORKSPACE }).specs,
    null,
    'no merge base',
  );
  assert.equal(impact({ lockfile: null }).specs, null, 'lockfile deleted');
  assert.equal(impact(lockfileWith('  zod@4.6.5: {}\n', '')).specs, null, 'missing snapshot');
  assert.equal(
    impact(lockfileWith('  apps/web:\n', '  apps/webapp:\n')).specs,
    null,
    'no web importer',
  );
  assert.equal(impact({ lockfile: `${LOCKFILE}\nnote: |\n  block\n` }).specs, null, 'block scalar');
});

test('the dependency files share one comparison and never fall into the shared-surface fallback', () => {
  let reads = 0;
  const result = select(['pnpm-lock.yaml', 'pnpm-workspace.yaml'], () => {
    reads += 1;
    return { specs: ['token-gate'], why: 'stub' };
  });
  assert.equal(reads, 1);
  assert.equal(result.full, false);
  assert.deepEqual(result.selection, ['token-gate.spec.ts']);
});

test('a snapshot baseline selects only the spec that owns it', () => {
  const result = select(['apps/web/e2e/gallery-snapshots.spec.ts-snapshots/row-dark-linux.png']);
  assert.equal(result.full, false);
  assert.deepEqual(result.selection, ['gallery-snapshots.spec.ts']);
});

test('the design doc the gallery imports selects the design specs; the component doc selects none', () => {
  assert.deepEqual(select(['apps/web/DESIGN.md']).selection, [
    'a11y-axe.spec.ts',
    'gallery-snapshots.spec.ts',
    'texture-grain.spec.ts',
  ]);
  assert.deepEqual(select(['apps/web/COMPONENTS.md']).selection, []);
});

test('shared web surfaces and the e2e runner itself still run everything', () => {
  for (const path of [
    'apps/web/src/api/hooks.ts',
    'apps/web/src/fixtures/records.ts',
    'apps/web/src/components/settings/quota-row.tsx',
    'apps/web/playwright.config.ts',
    'scripts/e2e-affected.mjs',
    'scripts/e2e-affected-select.mjs',
    'scripts/heavy-slots.mjs',
    'scripts/timed-partition.mjs',
  ]) {
    const result = select([path]);
    assert.equal(result.full, true, path);
    assert.deepEqual(result.selection, ALL_SPECS, path);
  }
});

test('server changes run the live-server specs; files outside both apps run none', () => {
  assert.deepEqual(select(['apps/server/src/index.ts']).selection, [
    'live-server-boot.spec.ts',
    'token-gate.spec.ts',
  ]);
  assert.deepEqual(
    select(['docs/ops/lane-workers.md', 'scripts/e2e-shard-weights.json']).selection,
    [],
  );
});

test('a workspace package the web app links runs everything', () => {
  for (const path of ['packages/shared/src/phase.ts', 'packages/shared/merge-gate-paths.json']) {
    const result = select([path]);
    assert.equal(result.full, true, path);
    assert.deepEqual(result.selection, ALL_SPECS, path);
    assert.match(result.reasons[0], /packages\/shared/, path);
  }
});

test('a workspace package only the live server links runs the live-server specs, through nested links', () => {
  assert.notEqual(SERVER_ONLY_PACKAGE, LOCKFILE);
  for (const path of ['packages/store/src/db.ts', 'packages/deep/index.ts']) {
    const result = select([path], undefined, SERVER_ONLY_PACKAGE);
    assert.equal(result.full, false, path);
    assert.deepEqual(result.selection, ['live-server-boot.spec.ts', 'token-gate.spec.ts'], path);
  }
});

test('a workspace package neither app links selects nothing, and a sibling name is not a prefix match', () => {
  assert.deepEqual(select(['apps/daemon/src/index.ts']).selection, []);
  assert.deepEqual(
    select(['packages/shared-docs/readme.md'], undefined, SERVER_ONLY_PACKAGE).selection,
    [],
  );
});

test('an unreadable lockfile cannot say who links a package, so a path outside both apps runs everything', () => {
  assert.equal(select(['packages/shared/src/phase.ts'], undefined, null).full, true);
  assert.equal(select(['docs/a.md'], undefined, 'importers:\n  .: {}\n').full, true);
});

test('the committed lockfile and workspace parse, and their closures reach the packages they must', () => {
  const lockfile = readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8');
  const workspace = readFileSync(new URL('../pnpm-workspace.yaml', import.meta.url), 'utf8');
  const real = { lockfile, workspace };
  assert.deepEqual(dependencyImpact({ base: real, head: real }).specs, []);
  const flipBuild = (name) => {
    const line = new RegExp(`^( +'?${name}'?: )(true|false)$`, 'm');
    assert.match(workspace, line, `pnpm-workspace.yaml has no build setting for ${name}`);
    const flipped = workspace.replace(
      line,
      (_, key, value) => `${key}${value === 'true' ? 'false' : 'true'}`,
    );
    return dependencyImpact({ base: real, head: { lockfile, workspace: flipped } });
  };
  assert.equal(flipBuild('esbuild').specs, null);
  assert.deepEqual(flipBuild('better-sqlite3').specs, LIVE_SERVER);
  const reactKey = lockfile.match(/^ {2}react@(\d+\.\d+\.\d+):/m);
  assert.ok(reactKey, 'pnpm-lock.yaml has a react snapshot');
  const bumped = lockfile.replace(
    new RegExp(`(^ {2}react@${reactKey[1]}:\\n {4}resolution: \\{integrity: )`, 'm'),
    '$1x',
  );
  assert.notEqual(bumped, lockfile);
  assert.equal(dependencyImpact({ base: real, head: { lockfile: bumped, workspace } }).specs, null);
  const reach = workspacePackages(lockfile);
  assert.equal(reach('packages/shared/src/index.ts').specs, null);
  assert.deepEqual(reach('apps/daemon/src/index.ts').specs, []);
  assert.deepEqual(reach('docs/README.md'), null);
});

test('the yaml reader keeps documents, quoted keys, flow values, lists and block scalars', () => {
  const [first, second] = parseYamlDocuments(
    "---\na: 1\n---\n'@x/y@1(z@2)':\n  resolution: {integrity: q}\n  list:\n    - 'one'\n    - two\n  note: |\n    line one\n    line two\n",
  );
  assert.deepEqual(first, { a: 1 });
  assert.deepEqual(second, {
    '@x/y@1(z@2)': {
      resolution: { integrity: 'q' },
      list: ['one', 'two'],
      note: 'line one\nline two\n',
    },
  });
  assert.throws(() => parseYamlDocuments('a: [1\n'));
});

test('every selected spec lands on exactly one shard, whatever order or shard count', () => {
  const specs = listSpecs();
  const weights = JSON.parse(
    readFileSync(new URL('./e2e-shard-weights.json', import.meta.url), 'utf8'),
  );
  for (const count of [1, 2, 5, 8]) {
    const shards = partitionByWeight(specs, weights, count);
    assert.deepEqual(shards.flat().sort(), [...specs].sort(), `${count} shards`);
    assert.deepEqual(partitionByWeight([...specs].reverse(), weights, count), shards);
  }
  const few = partitionByWeight(['a.spec.ts', 'b.spec.ts'], weights, 5);
  assert.deepEqual(few.flat().sort(), ['a.spec.ts', 'b.spec.ts']);
  assert.equal(few.filter((shard) => shard.length === 0).length, 3);
});

test('weights sum per spec from a CI list-reporter log and ignore everything else', () => {
  const log = [
    '2026-11-02T07:06:24.2Z Running 4 tests using 2 workers',
    '2026-11-02T07:06:30.1Z   ✓  1 e2e/board-shell.spec.ts:2:5 › opens › with a › title (303ms)',
    '2026-11-02T07:06:31.1Z   ✓  2 e2e/board-shell.spec.ts:9:3 › second (1.2s)',
    '2026-11-02T07:06:32.1Z   ✓  3 [chromium] › e2e/token-gate.spec.ts:4:1 › gate (1.5m)',
    '2026-11-02T07:06:33.1Z   -  4 e2e/token-gate.spec.ts:8:1 › skipped',
    '2026-11-02T07:06:34.1Z   ✓  @cairn/web  test/a.test.ts (3 tests) 812ms',
  ].join('\n');
  assert.deepEqual(parseWeights(log), {
    'board-shell.spec.ts': 1503,
    'token-gate.spec.ts': 90_000,
  });
});

test('a refresh overwrites recorded specs, keeps the rest and drops deleted specs', () => {
  assert.deepEqual(
    mergeWeights(
      { 'a.spec.ts': 10, 'gone.spec.ts': 5, 'b.spec.ts': 7 },
      { 'a.spec.ts': 0, 'c.spec.ts': 3 },
      ['a.spec.ts', 'b.spec.ts', 'c.spec.ts'],
    ),
    { 'a.spec.ts': 1, 'b.spec.ts': 7, 'c.spec.ts': 3 },
  );
});

test('the committed e2e weights name existing specs with positive times', () => {
  const specs = new Set(listSpecs());
  const committed = JSON.parse(
    readFileSync(new URL('./e2e-shard-weights.json', import.meta.url), 'utf8'),
  );
  for (const [spec, ms] of Object.entries(committed)) {
    assert.ok(specs.has(spec), spec);
    assert.ok(Number.isInteger(ms) && ms > 0, spec);
  }
});

test('ci shards e2e-affected by the matrix size and runs the CSS gate once', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const job = workflow.split('\n  e2e-affected:\n')[1].split(/\n {2}[a-z][\w-]*:\n/)[0];
  assert.match(job, /^ {6}fail-fast: false$/m);
  assert.match(job, /^ {8}shard: \[1(, \d+)+\]$/m);
  assert.ok(
    job.includes(
      `run: pnpm --filter @cairn/web e2e:affected --shard=\${{ matrix.shard }}/\${{ strategy.job-total }}\n`,
    ),
  );
  for (const step of ['Fixture build for the CSS mechanism gate', 'CSS mechanism gate (#747)']) {
    const block = job.split(`- name: ${step}\n`)[1].split('\n      - ')[0];
    assert.match(block, /if: \$\{\{ !cancelled\(\) && matrix\.shard == 1 \}\}/, step);
  }
  assert.match(job, /name: gallery-snapshots-affected-\$\{\{ matrix\.shard \}\}/);
});

for (const path of ['apps/web/src/routes/account-page.tsx', 'apps/web/e2e/live-server.ts']) {
  test(`${path} selects the real account settings flow without a full fallback`, () => {
    const result = selectSpecs({
      paths: [path],
      allSpecs: listSpecs(),
      dependencies: () => ({ specs: [], why: 'unchanged dependencies' }),
      workspace: () => () => null,
    });

    assert.equal(result.full, false);
    assert.ok(result.selection.includes('account-release-removal.spec.ts'));
  });
}

test('Activity and palette source edits keep their navigation regressions in the affected set', () => {
  for (const path of [
    'apps/web/src/routes/activity-page.tsx',
    'apps/web/src/search/activity-model.ts',
    'apps/web/src/search/activity-href.ts',
    'apps/web/src/search/query-chip.tsx',
    'apps/web/src/search/search-query.ts',
    'apps/web/src/overlay/search-panel.tsx',
    'apps/web/src/board/sidebar.tsx',
  ]) {
    const result = selectSpecs({
      paths: [path],
      allSpecs: listSpecs(),
      dependencies: () => assert.fail('no dependency change'),
      workspace: () => workspacePackages(LOCKFILE),
    });
    assert.equal(result.full, false, path);
    assert.ok(result.selection.includes('activity-page.spec.ts'), path);
    assert.ok(result.selection.includes('search-syntax-palette.spec.ts'), path);
  }
});
