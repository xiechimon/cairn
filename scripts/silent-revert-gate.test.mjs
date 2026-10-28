import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { checkSilentReverts } from './silent-revert-gate.mjs';

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function history({ resolved = true } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'cairn-1834-'));
  roots.push(cwd);
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  git('init', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  writeFileSync(join(cwd, 'git.ts'), 'base\n');
  git('add', 'git.ts');
  git('commit', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  writeFileSync(join(cwd, 'git.ts'), 'base\nretryPush();\n');
  git('commit', '-am', 'add retry (#1786)');
  const merged = git('rev-parse', 'HEAD');
  git('switch', '-c', 'lane', base);
  writeFileSync(join(cwd, 'git.ts'), 'base\notherWork();\n');
  git('commit', '-am', 'stale rewrite');
  if (resolved) git('merge', '-s', 'ours', '-m', 'resolve without the incoming retry', 'main');
  return { cwd, git, base, merged, head: git('rev-parse', 'HEAD') };
}

test('names the merged PR and its removed line, and accepts an explicit reference only', () => {
  const h = history();
  const input = { ...h, pulls: [{ number: 1786, merge_commit_sha: h.merged }], body: '' };
  assert.deepEqual(checkSilentReverts(input), [
    { number: 1786, path: 'git.ts', line: 2, text: 'retryPush();' },
  ]);
  assert.equal(checkSilentReverts({ ...input, body: 'Intentional change to #1786.' }).length, 0);
  assert.equal(checkSilentReverts({ ...input, body: 'Related to #17860.' }).length, 1);
});

test('unchanged added lines and commits outside the base interval do not fail', () => {
  const h = history();
  assert.deepEqual(
    checkSilentReverts({
      ...h,
      head: h.merged,
      body: '',
      pulls: [{ number: 1786, merge_commit_sha: h.merged }],
    }),
    [],
  );
  assert.deepEqual(
    checkSilentReverts({ ...h, body: '', pulls: [{ number: 1, merge_commit_sha: h.base }] }),
    [],
  );
});

test('tracks a renamed file and distinguishes identical lines by position', () => {
  const h = history();
  h.git('switch', 'main');
  writeFileSync(join(h.cwd, 'git.ts'), 'retryPush();\nbase\nretryPush();\n');
  h.git('commit', '-am', 'duplicate text');
  const base = h.git('rev-parse', 'HEAD');
  writeFileSync(join(h.cwd, 'git.ts'), 'retryPush();\nbase\nretryPush();\nnewRetry();\n');
  h.git('commit', '-am', 'new retry');
  const merged = h.git('rev-parse', 'HEAD');
  h.git('switch', '-c', 'rename', base);
  h.git('mv', 'git.ts', 'renamed.ts');
  writeFileSync(join(h.cwd, 'renamed.ts'), 'base\nretryPush();\n');
  h.git('commit', '-am', 'rename and remove');
  h.git('merge', '-s', 'ours', '-m', 'resolve without the incoming feature', 'main');
  const failures = checkSilentReverts({
    cwd: h.cwd,
    base,
    head: h.git('rev-parse', 'HEAD'),
    pulls: [{ number: 2, merge_commit_sha: merged }],
    body: '',
  });
  assert.equal(failures.length, 1);
  assert.equal(failures[0].text, 'newRetry();');
});

test('renaming protected lines without removing them passes', () => {
  const h = history();
  h.git('switch', 'main');
  h.git('switch', '-c', 'preserve');
  h.git('mv', 'git.ts', 'renamed.ts');
  h.git('commit', '-am', 'rename only');
  assert.deepEqual(
    checkSilentReverts({
      ...h,
      baseHead: h.merged,
      head: h.git('rev-parse', 'HEAD'),
      pulls: [{ number: 1786, merge_commit_sha: h.merged }],
      body: '',
    }),
    [],
  );
});

test('independent edits in a stale branch preserve the upstream addition through Git merge', () => {
  const h = history();
  h.git('switch', 'main');
  const content = ['base();', ...Array.from({ length: 20 }, (_, i) => `keep${i}();`)];
  writeFileSync(join(h.cwd, 'git.ts'), `${content.join('\n')}\n`);
  h.git('commit', '-am', 'fixture base');
  const base = h.git('rev-parse', 'HEAD');
  writeFileSync(join(h.cwd, 'git.ts'), `${content.join('\n')}\nnewFeature();\n`);
  h.git('commit', '-am', 'upstream feature');
  const merged = h.git('rev-parse', 'HEAD');
  h.git('switch', '-c', 'independent', base);
  content[0] = 'updatedBase();';
  writeFileSync(join(h.cwd, 'git.ts'), `${content.join('\n')}\n`);
  h.git('commit', '-am', 'independent edit');
  const head = h.git('rev-parse', 'HEAD');
  const tree = h.git('merge-tree', '--write-tree', merged, head);
  assert.match(h.git('show', `${tree}:git.ts`), /newFeature\(\);/);
  assert.deepEqual(
    checkSilentReverts({
      cwd: h.cwd,
      base,
      baseHead: merged,
      head,
      pulls: [{ number: 12, merge_commit_sha: merged }],
      body: '',
    }),
    [],
  );
});

test('an unresolved merge conflict cannot certify the absence of silent reverts', () => {
  const h = history({ resolved: false });
  assert.throws(
    () =>
      checkSilentReverts({
        ...h,
        baseHead: h.merged,
        pulls: [{ number: 1786, merge_commit_sha: h.merged }],
        body: '',
      }),
    /merge conflict/i,
  );
});

test('the CLI detects an upstream deletion introduced by resolving a merge into the lane', () => {
  const h = history();
  const bin = join(h.cwd, 'bin');
  mkdirSync(bin);
  writeFileSync(
    join(bin, 'gh'),
    `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(JSON.stringify([[{ number: 1786, merged_at: '2026-10-26T00:00:00Z', merge_commit_sha: h.merged }]]))});\n`,
    { mode: 0o755 },
  );
  const event = join(h.cwd, 'event.json');
  writeFileSync(
    event,
    JSON.stringify({
      pull_request: { number: 1834, base: { sha: h.merged }, head: { sha: h.head }, body: '' },
    }),
  );
  const result = spawnSync(
    process.execPath,
    [join(import.meta.dirname, 'silent-revert-gate.mjs')],
    {
      cwd: h.cwd,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        GITHUB_EVENT_PATH: event,
        GITHUB_REPOSITORY: 'octo/repo',
      },
      encoding: 'utf8',
    },
  );
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /PR #1786 git\.ts:2: retryPush\(\);/);
});

function setupNodeCacheFailures(workflow) {
  const steps = [];
  let inJobs = false;
  let jobName = '';
  let uses = '';
  let body = '';
  let open = false;
  const lines = workflow.split('\n');
  for (let index = 0; index <= lines.length; index++) {
    const line = lines[index] ?? '';
    const jobKey = inJobs ? /^ {2}([^\s:#][^:]*):\s*$/.exec(line) : null;
    const stepStart = Boolean(inJobs && jobName && /^ {6}- /.test(line));
    const leftJobs = Boolean(inJobs && /^\S/.test(line) && line.trim() !== '');
    if (open && (index === lines.length || jobKey || stepStart || leftJobs)) {
      steps.push({ jobName, uses, body });
      open = false;
      uses = '';
      body = '';
    }
    if (index === lines.length) break;
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true;
      continue;
    }
    if (!inJobs) continue;
    if (leftJobs) {
      inJobs = false;
      jobName = '';
      continue;
    }
    if (jobKey) {
      jobName = jobKey[1];
      continue;
    }
    if (!stepStart) {
      if (!open) continue;
      body += `\n${line}`;
      if (!uses) uses = /^\s*uses:\s*(\S+)/.exec(line)?.[1] ?? '';
      continue;
    }
    open = true;
    uses = /uses:\s*(\S+)/.exec(line)?.[1] ?? '';
    body = line;
  }
  const failures = [];
  let current = '';
  let pnpmReady = false;
  for (const step of steps) {
    if (step.jobName !== current) {
      current = step.jobName;
      pnpmReady = false;
    }
    const code = step.body
      .split('\n')
      .filter((entry) => !/^\s*#/.test(entry))
      .join('\n');
    const setupNode =
      step.uses.startsWith('actions/setup-node@') || step.uses === 'actions/setup-node';
    const cacheOff = /^[ \t]*package-manager-cache:[ \t]*false[ \t]*(?:#.*)?$/m.test(code);
    if (setupNode && !cacheOff && !pnpmReady)
      failures.push(
        `${step.jobName}: setup-node looks up the package manager because package-manager-cache defaults to true`,
      );
    if (step.uses.startsWith('pnpm/action-setup@') || step.uses === 'pnpm/action-setup')
      pnpmReady = true;
  }
  return failures;
}

const brokenSetup = `
jobs:
  silent-revert-gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09
      - uses: actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444
        with:
          node-version: 24
`;

test('setup-node without pnpm installed is rejected', () => {
  assert.deepEqual(setupNodeCacheFailures(brokenSetup), [
    'silent-revert-gate: setup-node looks up the package manager because package-manager-cache defaults to true',
  ]);
  const latePnpm = `${brokenSetup}      - uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1\n`;
  assert.equal(setupNodeCacheFailures(latePnpm).length, 1);
});

test('an earlier pnpm setup or package-manager-cache false is accepted', () => {
  const cacheOff = brokenSetup.replace(
    'node-version: 24',
    'node-version: 24\n          package-manager-cache: false',
  );
  const pnpmFirst = brokenSetup.replace(
    '      - uses: actions/setup-node@',
    '      - uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1\n      - uses: actions/setup-node@',
  );
  assert.deepEqual(setupNodeCacheFailures(cacheOff), []);
  assert.deepEqual(setupNodeCacheFailures(pnpmFirst), []);
});

test('committed workflows install pnpm before setup-node caches it', () => {
  const directory = join(import.meta.dirname, '../.github/workflows');
  const failures = readdirSync(directory)
    .filter((name) => name.endsWith('.yml'))
    .flatMap((name) =>
      setupNodeCacheFailures(readFileSync(join(directory, name), 'utf8')).map(
        (failure) => `${name}: ${failure}`,
      ),
    );
  assert.deepEqual(failures, []);
});

test('a removed line beginning with two dashes is content, not a patch header', () => {
  const h = history();
  h.git('switch', 'main');
  writeFileSync(join(h.cwd, 'git.ts'), 'base\n--retry\n');
  h.git('commit', '-am', 'option added');
  const merged = h.git('rev-parse', 'HEAD');
  h.git('switch', 'lane');
  h.git('merge', '-s', 'ours', '-m', 'resolve without the incoming option', 'main');
  assert.equal(
    checkSilentReverts({
      ...h,
      head: h.git('rev-parse', 'HEAD'),
      baseHead: merged,
      pulls: [{ number: 8, merge_commit_sha: merged }],
      body: '',
    }).some((failure) => failure.text === '--retry'),
    true,
  );
});
