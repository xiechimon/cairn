import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { makeTestTempDir } from './test-tmpdir.mjs';

const SCRIPTS = new URL('.', import.meta.url).pathname;
const REGISTRY = '.claude/skills/verify-cairn/feature-map.json';
const MAP = 'docs/feature-map.md';
const SKILL_MAP = '.claude/skills/verify-cairn/feature-map.md';

const APP_TSX = `import { BoardPage } from './routes/board-page.js';
import { SCHEDULES_HREF } from './schedules/href.js';
export const router = createBrowserRouter([
  { path: '/app', element: <BoardPage /> },
  { path: SCHEDULES_HREF, element: <BoardPage /> },
  { path: \`\${SCHEDULES_HREF}/:id\`, element: <BoardPage /> },
  { path: '*', element: <Navigate to="/app" replace /> },
]);
`;

const SETTINGS_TSX = `const GROUPS = [
  { heading: null, sections: [
    { id: 'account', label: '账号', Icon: User, element: () => <AccountPage /> },
  ] },
];
`;

const SCHEDULES_TSX = `export function SchedulesPage() {
  return (
    <div>
      <button data-testid="schedule-new" aria-keyshortcuts="Mod+K">{t('新建')}</button>
      <span data-testid={open ? 'schedule-open' : 'schedule-closed'} />
      <span data-testid={\`schedule-row-\${id}\`} />
    </div>
  );
}
`;

const ROUTES_TS = `export function register(app) {
  app.get('/api/schedules', handler);
  app.post(
    '/api/schedules/:id/run',
    handler,
  );
  app.get('/api/user/me', handler);
}
`;

function baseRegistry() {
  return {
    repo: 'owner/repo',
    pending: {},
    batches: [{ id: 'B1', title: 'Shell research', scope: 'Compare shells.' }],
    features: [
      {
        id: 'schedules',
        name: 'Schedules',
        summary: 'Recurring work.',
        centrality: 1,
        status: 'shipped',
        code: { web: ['apps/web/src/schedules'], server: ['apps/server/src/routes-x.ts'] },
        routes: { web: ['/app/schedules', '/app/schedules/:id'], server: ['/api/schedules**'] },
        research: ['docs/research/schedules.md'],
        frontendDesign: ['docs/design/schedules.md'],
        backendDesign: ['docs/spec/01-schedules.md'],
        evidence: ['apps/server/test/schedules.test.ts'],
        states: 'Empty list, a list of schedules, and a running schedule.',
        reach: ['open /app/schedules', 'click testid:schedule-new', 'click label:新建'],
      },
      {
        id: 'shell',
        name: 'App shell and account',
        summary: 'Home and account.',
        centrality: 3,
        status: 'partial',
        code: { web: ['apps/web/src/App.tsx'] },
        routes: { web: ['/app', 'settings:account'], server: ['/api/user/me'] },
        research: { gap: 'nobody compared reference products' },
        frontendDesign: ['docs/design/schedules.md'],
        backendDesign: { na: 'reads the session only' },
        evidence: ['apps/server/test/schedules.test.ts'],
        states: 'Signed in.',
        reach: ['settings account'],
        batch: 'B1',
      },
    ],
  };
}

function write(root, rel, content) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

function writeRegistry(root, registry) {
  write(root, REGISTRY, `${JSON.stringify(registry, null, 2)}\n`);
}

function makeFixtureRepo(registry = baseRegistry()) {
  const root = makeTestTempDir('fm-gen-');
  for (const name of ['generate-feature-map.mjs', 'eval-coverage.mjs']) {
    write(root, `scripts/${name}`, '');
    copyFileSync(join(SCRIPTS, name), join(root, 'scripts', name));
  }
  write(root, 'scripts/eval-capabilities.json', '[]');
  write(root, 'apps/web/src/App.tsx', APP_TSX);
  write(
    root,
    'apps/web/src/schedules/href.ts',
    "export const SCHEDULES_HREF = '/app/schedules';\n",
  );
  write(root, 'apps/web/src/schedules/page.tsx', SCHEDULES_TSX);
  write(root, 'apps/web/src/i18n/en.ts', "export const en = {\n  账号: 'Account',\n};\n");
  write(root, 'apps/web/src/settings/settings-page.tsx', SETTINGS_TSX);
  write(root, 'apps/server/src/routes-x.ts', ROUTES_TS);
  write(root, 'apps/server/src/services/inner.ts', "client.get('/api/not-a-route');\n");
  write(root, 'apps/server/test/schedules.test.ts', 'export {};\n');
  write(root, 'docs/research/schedules.md', '# Schedules research\n');
  write(root, 'docs/design/schedules.md', '# Schedules design\n');
  write(root, 'docs/spec/01-schedules.md', '# Schedules spec\n');
  writeRegistry(root, registry);
  return root;
}

function run(root, args = [], env = {}) {
  return spawnSync(process.execPath, [join(root, 'scripts/generate-feature-map.mjs'), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, FEATURE_REGISTRY_BASE_SHA: '', ...env },
  });
}

function generated(root) {
  const result = run(root);
  assert.equal(result.status, 0, result.stderr);
  return readFileSync(join(root, MAP), 'utf8');
}

function checkFails(root, pattern, env) {
  const result = run(root, ['--check'], env);
  assert.notEqual(result.status, 0, 'check should fail');
  assert.match(result.stderr, pattern);
}

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function commitAll(root) {
  git(root, 'add', '.');
  git(
    root,
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@example.test',
    'commit',
    '-q',
    '--no-gpg-sign',
    '-m',
    'base',
  );
  return git(root, 'rev-parse', 'HEAD');
}

test('a complete registry renders a map that --check accepts', () => {
  const root = makeFixtureRepo();
  const doc = generated(root);
  assert.match(doc, /Schedules/);
  assert.match(doc, /\[docs\/research\/schedules\.md\]\(research\/schedules\.md\)/);
  assert.match(doc, /nobody compared reference products/);
  assert.match(doc, /### B1 · Shell research/);
  assert.match(doc, /## Eval coverage/);
  const skill = readFileSync(join(root, SKILL_MAP), 'utf8');
  assert.match(skill, /1\. `open \/app\/schedules`/);
  assert.match(
    skill,
    /Test ids in its code: `schedule-closed`, `schedule-new`, `schedule-open`, `schedule-row-\*`/,
  );
  assert.match(skill, /Keyboard shortcuts in its code: `Mod\+K`/);
  assert.match(skill, /`账号` \(Account\)/);
  assert.match(skill, /States: Empty list/);
  const result = run(root, ['--check']);
  assert.equal(result.status, 0, result.stderr);
});

test('a hand edit to the rendered map fails --check', () => {
  const root = makeFixtureRepo();
  generated(root);
  write(root, MAP, `${readFileSync(join(root, MAP), 'utf8')}\nhand edit\n`);
  checkFails(root, /docs\/feature-map\.md differs from/);
});

for (const slot of ['research', 'frontendDesign', 'backendDesign']) {
  test(`a feature without ${slot} links or an explicit gap fails`, () => {
    const registry = baseRegistry();
    registry.features[0][slot] = [];
    checkFails(makeFixtureRepo(registry), new RegExp(`schedules: ${slot} needs links`));
  });
}

test('a missing slot key fails like an empty one', () => {
  const registry = baseRegistry();
  delete registry.features[0].research;
  checkFails(makeFixtureRepo(registry), /schedules: research needs links/);
});

test('a link to a file that does not exist fails', () => {
  const registry = baseRegistry();
  registry.features[0].research = ['docs/research/gone.md'];
  checkFails(
    makeFixtureRepo(registry),
    /schedules: research links docs\/research\/gone\.md, which does not exist/,
  );
});

test('a pending note counts as a link and renders as not on main', () => {
  const registry = baseRegistry();
  registry.features[0].research = ['docs/research/later.md'];
  registry.pending = { 'docs/research/later.md': 'uncommitted in another worktree' };
  const root = makeFixtureRepo(registry);
  const doc = generated(root);
  assert.match(doc, /docs\/research\/later\.md.*not on main/);
  assert.match(doc, /uncommitted in another worktree/);
  assert.equal(run(root, ['--check']).status, 0);
});

test('a pending note nobody cites fails', () => {
  const registry = baseRegistry();
  registry.pending = { 'docs/research/orphan.md': 'uncommitted' };
  checkFails(makeFixtureRepo(registry), /pending note docs\/research\/orphan\.md is not cited/);
});

test('a code path or evidence path that does not exist fails', () => {
  const registry = baseRegistry();
  registry.features[0].code.web = ['apps/web/src/nowhere'];
  registry.features[0].evidence = ['apps/web/e2e/nowhere.spec.ts'];
  const root = makeFixtureRepo(registry);
  checkFails(root, /schedules: code\.web path apps\/web\/src\/nowhere does not exist/);
  checkFails(root, /schedules: evidence path apps\/web\/e2e\/nowhere\.spec\.ts does not exist/);
});

test('a shipped feature without evidence fails', () => {
  const registry = baseRegistry();
  registry.features[0].evidence = [];
  checkFails(
    makeFixtureRepo(registry),
    /schedules: a shipped feature needs at least one evidence path/,
  );
});

test('a new web page that maps to no feature fails', () => {
  const root = makeFixtureRepo();
  generated(root);
  write(
    root,
    'apps/web/src/App.tsx',
    APP_TSX.replace(
      "  { path: '*'",
      "  { path: '/app/inbox', element: <BoardPage /> },\n  { path: '*'",
    ),
  );
  checkFails(root, /web route \/app\/inbox maps to no feature/);
});

test('a new settings section that maps to no feature fails', () => {
  const root = makeFixtureRepo();
  generated(root);
  write(
    root,
    'apps/web/src/settings/settings-page.tsx',
    SETTINGS_TSX.replace(
      '    { id: ',
      "    { id: 'billing', label: 'Billing', Icon: Card, element: () => <Billing /> },\n    { id: ",
    ),
  );
  checkFails(root, /web route settings:billing maps to no feature/);
});

test('a new server route that maps to no feature fails, and service calls are not routes', () => {
  const root = makeFixtureRepo();
  generated(root);
  write(
    root,
    'apps/server/src/routes-y.ts',
    "export function more(app) {\n  app.delete('/api/inbox/:id', handler);\n}\n",
  );
  const result = run(root, ['--check']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /server route DELETE \/api\/inbox\/:id maps to no feature/);
  assert.doesNotMatch(result.stderr, /not-a-route/);
});

test('a route pattern that matches no route fails', () => {
  const registry = baseRegistry();
  registry.features[0].routes.server.push('/api/retired**');
  checkFails(
    makeFixtureRepo(registry),
    /schedules: server route pattern \/api\/retired\*\* matches no route/,
  );
});

test('a pattern without the prefix suffix matches only the exact route', () => {
  const registry = baseRegistry();
  registry.features[0].routes.server = ['/api/schedules'];
  checkFails(
    makeFixtureRepo(registry),
    /server route POST \/api\/schedules\/:id\/run maps to no feature/,
  );
});

test('batches must match the features that have gaps', () => {
  const noBatch = baseRegistry();
  delete noBatch.features[1].batch;
  checkFails(makeFixtureRepo(noBatch), /shell: has gaps, so it needs a batch/);

  const unknown = baseRegistry();
  unknown.features[1].batch = 'B9';
  checkFails(makeFixtureRepo(unknown), /shell: batch B9 is not defined/);

  const unused = baseRegistry();
  unused.batches.push({ id: 'B2', title: 'Nothing', scope: 'Nothing.' });
  checkFails(makeFixtureRepo(unused), /batch B2 holds no feature with a gap/);

  const complete = baseRegistry();
  complete.features[0].batch = 'B1';
  checkFails(makeFixtureRepo(complete), /schedules: has no gaps, so it must not carry a batch/);
});

test('a duplicate id or an unknown key fails', () => {
  const duplicate = baseRegistry();
  duplicate.features[1].id = 'schedules';
  checkFails(makeFixtureRepo(duplicate), /duplicate feature id schedules/);

  const unknownKey = baseRegistry();
  unknownKey.features[0].owner = 'ian';
  checkFails(makeFixtureRepo(unknownKey), /schedules: unknown key owner/);
});

test('against a base, a new gap fails while an inherited gap passes', () => {
  const root = makeFixtureRepo();
  generated(root);
  git(root, 'init', '-q');
  const base = commitAll(root);
  const inherited = run(root, ['--check'], { FEATURE_REGISTRY_BASE_SHA: base });
  assert.equal(inherited.status, 0, inherited.stderr);

  const registry = baseRegistry();
  registry.features[0].research = { gap: 'dropped the note' };
  registry.features[0].batch = 'B1';
  writeRegistry(root, registry);
  generated(root);
  checkFails(root, /schedules: research is a new gap; link the research/, {
    FEATURE_REGISTRY_BASE_SHA: base,
  });
});

test('against a base without a registry, the gap ratchet starts from the head', () => {
  const root = makeFixtureRepo();
  generated(root);
  git(root, 'init', '-q');
  write(root, 'scripts/eval-capabilities.json', '[]\n');
  git(root, 'add', 'scripts/eval-capabilities.json');
  git(
    root,
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@example.test',
    'commit',
    '-q',
    '--no-gpg-sign',
    '-m',
    'base',
  );
  const base = git(root, 'rev-parse', 'HEAD');
  const result = run(root, ['--check'], { FEATURE_REGISTRY_BASE_SHA: base });
  assert.equal(result.status, 0, result.stderr);
});

test('renaming a test id in feature code without regenerating fails --check', () => {
  const root = makeFixtureRepo();
  generated(root);
  write(
    root,
    'apps/web/src/schedules/page.tsx',
    SCHEDULES_TSX.replace('aria-keyshortcuts="Mod+K"', 'data-x="1"').replace(
      '<button',
      '<button data-testid="schedule-extra"',
    ),
  );
  checkFails(root, /feature-map\.md differs from/);
});

test('reach steps may use concrete ids for parameterized routes and either branch of a conditional test id', () => {
  const registry = baseRegistry();
  registry.features[0].reach = [
    'open /app/schedules/42',
    'click testid:schedule-open',
    'click testid:schedule-closed',
    'click testid:schedule-row-7',
  ];
  const root = makeFixtureRepo(registry);
  generated(root);
  assert.equal(run(root, ['--check']).status, 0);
  checkFails(
    makeFixtureRepo({
      ...registry,
      features: [
        { ...registry.features[0], reach: ['open /app/schedules/42/edit'] },
        registry.features[1],
      ],
    }),
    /opens \/app\/schedules\/42\/edit, which is not a web route/,
  );
});

for (const [step, pattern] of [
  ['open /app/nowhere', /opens \/app\/nowhere, which is not a web route/],
  ['settings billing', /names settings section billing, which does not exist/],
  ['click testid:gone', /targets data-testid gone, which no web source sets/],
  ['press Mod+J', /presses Mod\+J, which no web source declares/],
  ['click Save', /must target testid:<id> or label:/],
  ['click label:删除', /targets label 删除, which no t\(\) call in web source has/],
  ['drag it', /must start with open, settings, click, hover, press or type/],
]) {
  test(`a reach step "${step}" that the source cannot back fails`, () => {
    const registry = baseRegistry();
    registry.features[0].reach = [step];
    checkFails(makeFixtureRepo(registry), pattern);
  });
}

test('a built feature without reach steps or states fails, a planned one may omit them', () => {
  const registry = baseRegistry();
  delete registry.features[0].reach;
  delete registry.features[0].states;
  const root = makeFixtureRepo(registry);
  checkFails(root, /schedules: a shipped feature needs reach steps/);
  checkFails(root, /schedules: a shipped feature needs states/);

  const planned = baseRegistry();
  planned.features.push({
    id: 'desktop',
    name: 'Desktop',
    summary: 'Later.',
    centrality: 2,
    status: 'planned',
    research: ['docs/research/schedules.md'],
    frontendDesign: ['docs/design/schedules.md'],
    backendDesign: ['docs/spec/01-schedules.md'],
    evidence: [],
  });
  const plannedRoot = makeFixtureRepo(planned);
  generated(plannedRoot);
  assert.equal(run(plannedRoot, ['--check']).status, 0);
});

test('a verify recipe that does not exist fails', () => {
  const registry = baseRegistry();
  registry.features[0].verify = ['.claude/skills/verify-cairn/features/gone.md'];
  checkFails(makeFixtureRepo(registry), /schedules: verify recipe .*gone\.md does not exist/);
});

test('a hillclimb flow with no capability row still fails the generator', () => {
  const root = makeFixtureRepo();
  write(root, '.claude/hillclimb/orphan/cases.json', '{"cases":[]}\n');
  const result = run(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /hillclimb flow "orphan" has no capability row/);
});

test('the real registry passes its own check', () => {
  const result = spawnSync(
    process.execPath,
    [join(SCRIPTS, 'generate-feature-map.mjs'), '--check'],
    { encoding: 'utf8', env: { ...process.env, FEATURE_REGISTRY_BASE_SHA: '' } },
  );
  assert.equal(result.status, 0, result.stderr);
});
