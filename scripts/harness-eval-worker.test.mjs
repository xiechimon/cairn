import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import {
  isolatedEvalEnv,
  linkDependencies,
  linkWorkspaceDependencies,
  publishEvaluation,
  runIsolatedEvaluation,
  verifyBillingRoute,
} from './harness-eval-worker.mjs';

const run = promisify(execFile);

const digest = `pd2:${'1'.repeat(64)}`;
const resultPath = 'docs/verify/1975/harness-regression.json';
const result = {
  patchDigest: digest,
  harness_sha: '2'.repeat(64),
  decision_ok: 1,
  trace_digest: '3'.repeat(64),
};

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'cairn-worker-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const remote = join(root, 'remote.git');
  const seed = join(root, 'seed');
  const git = (cwd, ...args) =>
    execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-C', cwd, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  mkdirSync(seed);
  git(seed, 'init', '--initial-branch=lane/test');
  git(seed, 'config', 'user.email', 'worker@example.invalid');
  git(seed, 'config', 'user.name', 'Eval Worker');
  writeFileSync(join(seed, 'harness.txt'), 'original\n');
  writeFileSync(join(seed, 'other.txt'), 'original\n');
  git(seed, 'add', 'harness.txt', 'other.txt');
  git(seed, 'commit', '-m', 'initial');
  execFileSync('git', ['init', '--bare', remote], { stdio: 'ignore' });
  git(seed, 'remote', 'add', 'origin', remote);
  git(seed, 'push', 'origin', 'HEAD:refs/heads/lane/test');
  const head = git(seed, 'rev-parse', 'HEAD');
  const commands = [];
  const request = {
    repo: 'xiechimon/cairn',
    pr: '10',
    ticket: '1975',
    expectedHead: head,
    patchDigest: digest,
  };
  const dependencies = {
    remote,
    tempRoot: root,
    branch: 'lane/test',
    author: { name: 'Eval Worker', email: 'worker@example.invalid' },
    verifyRequest: () => ({ head, branch: 'lane/test', patchDigest: digest }),
    evaluate: ({ checkout, output }) => {
      mkdirSync(join(checkout, 'docs/verify/1975'), { recursive: true });
      writeFileSync(output, JSON.stringify(result));
    },
    observe: (args) => commands.push(args),
  };
  return { root, remote, seed, git, head, commands, request, dependencies };
}

test('valid publication creates exactly one result-only commit', async (t) => {
  const f = fixture(t);
  const published = await publishEvaluation(f.request, f.dependencies);
  assert.equal(
    f.git(f.seed, 'ls-remote', 'origin', 'refs/heads/lane/test').split(/\s/)[0],
    published.commit,
  );
  assert.equal(f.git(f.remote, 'rev-list', '--count', `${f.head}..${published.commit}`), '1');
  assert.equal(
    f.git(f.remote, 'diff', '--name-status', f.head, published.commit),
    `A\t${resultPath}`,
  );
  assert.deepEqual(
    JSON.parse(f.git(f.remote, 'show', `${published.commit}:${resultPath}`)),
    result,
  );
  assert.ok(
    f.commands.every((args) => !args.some((arg) => arg.includes('--force') || arg.startsWith('+'))),
  );
});

for (const [name, mutate] of [
  ['modified harness', (c) => writeFileSync(join(c, 'harness.txt'), 'changed')],
  ['untracked file', (c) => writeFileSync(join(c, 'extra.txt'), 'extra')],
  [
    'ignored untracked file',
    (c) => {
      writeFileSync(join(c, '.git/info/exclude'), 'hidden.txt\n');
      writeFileSync(join(c, 'hidden.txt'), 'hidden');
    },
  ],
  ['rename', (c) => renameSync(join(c, 'other.txt'), join(c, 'renamed.txt'))],
  ['deletion', (c) => rmSync(join(c, 'other.txt'))],
  ['second evidence file', (c) => writeFileSync(join(c, 'docs/verify/1975/extra.json'), '{}')],
  [
    'wrong ticket path',
    (c) => {
      mkdirSync(join(c, 'docs/verify/1976'), { recursive: true });
      writeFileSync(join(c, 'docs/verify/1976/harness-regression.json'), '{}');
    },
  ],
  ['invalid JSON', (_c, o) => writeFileSync(o, '{')],
  ['schema failure', (_c, o) => writeFileSync(o, '{}')],
  [
    'result digest mismatch',
    (_c, o) =>
      writeFileSync(o, JSON.stringify({ ...result, patchDigest: `pd2:${'4'.repeat(64)}` })),
  ],
  [
    'additional committed file',
    (c, _o, f) => {
      writeFileSync(join(c, 'harness.txt'), 'committed harness edit');
      f.git(c, 'add', 'docs', 'harness.txt');
      f.git(
        c,
        '-c',
        'user.name=Worker',
        '-c',
        'user.email=worker@example.invalid',
        'commit',
        '-m',
        'unexpected commit',
      );
    },
  ],
]) {
  test(`rejects ${name} before publication`, async (t) => {
    const f = fixture(t);
    const evaluate = f.dependencies.evaluate;
    f.dependencies.evaluate = (context) => {
      evaluate(context);
      mutate(context.checkout, context.output, f);
    };
    await assert.rejects(publishEvaluation(f.request, f.dependencies));
    assert.equal(
      f.git(f.seed, 'ls-remote', 'origin', 'refs/heads/lane/test').split(/\s/)[0],
      f.head,
    );
    assert.ok(!f.commands.some((args) => args.includes('push')));
  });
}

test('rejects requested digest mismatch before evaluation', async (t) => {
  const f = fixture(t);
  f.dependencies.verifyRequest = () => ({
    head: f.head,
    branch: 'lane/test',
    patchDigest: 'wrong',
  });
  f.dependencies.evaluate = () => assert.fail('evaluation must not start');
  await assert.rejects(publishEvaluation(f.request, f.dependencies), /digest/);
});

test('remote movement after evaluation prevents push', async (t) => {
  const f = fixture(t);
  const evaluate = f.dependencies.evaluate;
  let moved;
  f.dependencies.evaluate = (context) => {
    evaluate(context);
    writeFileSync(join(f.seed, 'other.txt'), 'new head');
    f.git(f.seed, 'add', 'other.txt');
    f.git(f.seed, 'commit', '-m', 'branch movement');
    f.git(f.seed, 'push', 'origin', 'HEAD:refs/heads/lane/test');
    moved = f.git(f.seed, 'rev-parse', 'HEAD');
  };
  await assert.rejects(publishEvaluation(f.request, f.dependencies), /head/);
  assert.equal(f.git(f.seed, 'ls-remote', 'origin', 'refs/heads/lane/test').split(/\s/)[0], moved);
  assert.ok(!f.commands.some((args) => args.includes('push')));
});

test('push failure propagates and leaves remote unchanged', async (t) => {
  const f = fixture(t);
  writeFileSync(join(f.remote, 'hooks/pre-receive'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  await assert.rejects(publishEvaluation(f.request, f.dependencies), /push/);
  assert.equal(f.git(f.seed, 'ls-remote', 'origin', 'refs/heads/lane/test').split(/\s/)[0], f.head);
});

test('rejects unsafe ticket paths before evaluation', async (t) => {
  const f = fixture(t);
  f.request.ticket = '../1976';
  await assert.rejects(publishEvaluation(f.request, f.dependencies), /ticket/);
});

test('updates an existing result with one result-only commit', async (t) => {
  const f = fixture(t);
  mkdirSync(join(f.seed, 'docs/verify/1975'), { recursive: true });
  writeFileSync(join(f.seed, resultPath), '{}');
  f.git(f.seed, 'add', resultPath);
  f.git(f.seed, 'commit', '-m', 'existing evidence');
  f.git(f.seed, 'push', 'origin', 'HEAD:refs/heads/lane/test');
  f.request.expectedHead = f.git(f.seed, 'rev-parse', 'HEAD');
  f.dependencies.verifyRequest = () => ({
    head: f.request.expectedHead,
    branch: 'lane/test',
    patchDigest: digest,
  });
  const published = await publishEvaluation(f.request, f.dependencies);
  assert.equal(
    f.git(f.remote, 'diff', '--name-status', f.request.expectedHead, published.commit),
    `M\t${resultPath}`,
  );
});

test('failed evaluation does not publish an otherwise valid result', async (t) => {
  const f = fixture(t);
  const evaluate = f.dependencies.evaluate;
  f.dependencies.evaluate = (context) => {
    evaluate(context);
    throw new Error('full evaluation failed');
  };
  await assert.rejects(publishEvaluation(f.request, f.dependencies), /full evaluation failed/);
  assert.ok(!f.commands.some((args) => args.includes('push')));
});

test('missing evidence is rejected', async (t) => {
  const f = fixture(t);
  f.dependencies.evaluate = () => {};
  await assert.rejects(publishEvaluation(f.request, f.dependencies), /only the requested result/);
});

test('billing verification uses the explicit relay without revealing credentials', async () => {
  const secret = 'test-secret-never-record';
  const route = await verifyBillingRoute(
    { url: 'https://relay.invalid/v1', key: secret },
    async (url, options) => {
      assert.equal(url, 'https://relay.invalid/v1/models');
      assert.equal(options.headers.Authorization, `Bearer ${secret}`);
      assert.equal(options.redirect, 'error');
      return new Response(JSON.stringify({ data: [{ id: 'glm-5.3' }] }));
    },
  );
  assert.equal(route.backend, 'pi');
  assert.ok(!JSON.stringify(route).includes(secret));
});

for (const response of [
  new Response('credential-containing failure', { status: 401 }),
  new Response('{}'),
  new Response('{'),
]) {
  test(`unverified billing route is rejected (${response.status}, ${response.headers.get('content-type')})`, async () => {
    await assert.rejects(
      verifyBillingRoute({ url: 'https://relay.invalid/v1', key: 'secret' }, async () => response),
      /Billing route verification failed/,
    );
  });
}

const workspacePackages = Object.freeze([
  'package.json',
  'packages/shared/package.json',
  'apps/daemon/package.json',
]);
const dependencyOnlyManifests = Object.freeze(['package.json', 'apps/daemon/package.json']);

function workspaceFixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'cairn-round1-workspace-'));
  const dependencyManifests = [...dependencyOnlyManifests];
  const manifests = [...workspacePackages];
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const mk = (path) => {
    mkdirSync(path, { recursive: true });
    return path;
  };
  mk(join(root, 'packages/shared/src/records'));
  writeFileSync(
    join(root, 'packages/shared/package.json'),
    JSON.stringify({
      name: '@cairn/shared',
      type: 'module',
      exports: { '.': './src/index.mjs', './records': './src/records/index.mjs' },
    }),
  );
  writeFileSync(join(root, 'packages/shared/src/index.mjs'), 'export const sharedValue = "ok";\n');
  writeFileSync(
    join(root, 'packages/shared/src/records/index.mjs'),
    'export const recordValue = "records-ok";\n',
  );
  mk(join(root, 'apps/daemon/src'));
  writeFileSync(
    join(root, 'apps/daemon/package.json'),
    JSON.stringify({ name: '@cairn/daemon', type: 'module', exports: './src/main.mjs' }),
  );
  writeFileSync(
    join(root, 'apps/daemon/src/main.mjs'),
    [
      'import { sharedValue } from "@cairn/shared";',
      'import { recordValue } from "@cairn/shared/records";',
      'import { depValue } from "fixture-dep";',
      'console.log(JSON.stringify({ sharedValue, recordValue, depValue }));',
      '',
    ].join('\n'),
  );
  mk(join(root, 'apps/daemon/node_modules/fixture-dep-pkg/fixture-dep'));
  writeFileSync(
    join(root, 'apps/daemon/node_modules/fixture-dep-pkg/fixture-dep/package.json'),
    JSON.stringify({ name: 'fixture-dep', type: 'module', exports: './index.mjs' }),
  );
  writeFileSync(
    join(root, 'apps/daemon/node_modules/fixture-dep-pkg/fixture-dep/index.mjs'),
    'export const depValue = "dep-ok";\n',
  );
  mk(join(root, 'apps/daemon/node_modules/@cairn'));
  symlinkSync(
    '../../../../packages/shared',
    join(root, 'apps/daemon/node_modules/@cairn/shared'),
    'dir',
  );
  symlinkSync(
    'fixture-dep-pkg/fixture-dep',
    join(root, 'apps/daemon/node_modules/fixture-dep'),
    'dir',
  );
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'fixture-root', private: true }),
  );
  writeFileSync(join(root, '.gitignore'), 'node_modules\n');
  execFileSync('git', ['init', '--initial-branch=lane/test', root], { stdio: 'ignore' });
  const git = (...args) =>
    execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-C', root, ...args], {
      stdio: 'ignore',
    });
  git('add', '.');
  git(
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '-m',
    'fixture',
  );
  const checkout = join(root, 'checkout');
  execFileSync(
    'git',
    ['-C', root, '-c', 'core.hooksPath=/dev/null', 'clone', '--no-local', root, checkout],
    { stdio: 'ignore' },
  );
  const scratch = mk(join(root, 'scratch'));
  return { root, checkout, scratch, manifests, dependencyManifests };
}

const gatedCredentialReader = () =>
  [
    'const fs = require("node:fs");',
    'const os = require("node:os");',
    'const path = require("node:path");',
    'const seen = [];',
    'for (const name of ["GH_TOKEN", "GITHUB_TOKEN", "GIT_CONFIG_GLOBAL", "GH_CONFIG_DIR", "SSH_AUTH_SOCK", "CAIRN_EVAL_RELAY_KEY", "GIT_ASKPASS"]) {',
    '  if (process.env[name]) seen.push(name + "=set");',
    '}',
    'const home = process.env.HOME ?? "";',
    'for (const name of [".git-credentials", ".gitconfig", ".config/gh/hosts.yml", ".config/git/credentials"]) {',
    '  if (home && fs.existsSync(path.join(home, name))) seen.push(name + "=present");',
    '}',
    'const probes = [',
    '  [process.env.GIT_CONFIG_GLOBAL, "git_config_global"],',
    '  [process.env.GH_CONFIG_DIR && path.join(process.env.GH_CONFIG_DIR, "hosts.yml"), "gh_hosts"],',
    '  [path.join(os.tmpdir(), "cairn-probe-git-credentials"), "tmp_git_credentials"],',
    '];',
    'for (const [target, label] of probes) {',
    '  if (!target) continue;',
    '  try { fs.readFileSync(target, "utf8"); seen.push(label + "=readable"); } catch {}',
    '}',
    'fs.writeFileSync(process.env.CAIRN_PROBE_MARKER, JSON.stringify({ seen }));',
  ].join('\n');

test('workspace package links keep their evaluated source after dependency copies', async (t) => {
  const { root, checkout, scratch, manifests, dependencyManifests } = workspaceFixture(t);
  writeFileSync(
    join(checkout, 'packages/shared/src/index.mjs'),
    'export const sharedValue = "evaluated-head";\n',
  );
  const links = linkDependencies({ trustedRoot: root, checkout, scratch, dependencyManifests });

  const { recreated } = linkWorkspaceDependencies({
    trustedRoot: root,
    checkout,
    scratch,
    manifests,
    dependencyManifests,
  });
  assert.equal(links.length, 1);
  assert.equal(recreated.length, 1);
  assert.equal(
    readlinkSync(join(checkout, 'apps/daemon/node_modules/@cairn/shared')),
    join(checkout, 'packages/shared'),
  );

  const out = execFileSync('node', [join(checkout, 'apps/daemon/src/main.mjs')], {
    encoding: 'utf8',
  });
  assert.deepEqual(JSON.parse(out), {
    sharedValue: 'evaluated-head',
    recordValue: 'records-ok',
    depValue: 'dep-ok',
  });
  for (const { target } of links) {
    if (existsSync(target)) rmSync(target);
  }
});

test('workspace links removed by a full dependency copy are restored before evaluation', async (t) => {
  const { root, checkout, scratch, manifests, dependencyManifests } = workspaceFixture(t);
  const links = linkDependencies({ trustedRoot: root, checkout, scratch, dependencyManifests });
  assert.throws(() =>
    execFileSync('node', [join(checkout, 'apps/daemon/src/main.mjs')], { stdio: 'pipe' }),
  );
  linkWorkspaceDependencies({
    trustedRoot: root,
    checkout,
    scratch,
    manifests,
    dependencyManifests,
  });
  const out = execFileSync('node', [join(checkout, 'apps/daemon/src/main.mjs')], {
    encoding: 'utf8',
  });
  assert.deepEqual(JSON.parse(out), {
    sharedValue: 'ok',
    recordValue: 'records-ok',
    depValue: 'dep-ok',
  });
  for (const { target } of links) {
    if (existsSync(target)) rmSync(target);
  }
});

test('evaluation environment removes inherited tokens and credential configuration', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'cairn-round1-env-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const realHome = join(root, 'real-home');
  const scratchHome = join(root, 'scratch-home');
  const ghConfig = join(root, 'gh-config');
  const scratchGitConfig = join(root, 'scratch-gitconfig');
  const probeMarker = join(root, 'probe-marker');
  for (const dir of [
    realHome,
    scratchHome,
    ghConfig,
    join(realHome, '.config/gh'),
    join(realHome, '.config/git'),
  ]) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(join(realHome, '.git-credentials'), 'https://worker:real-token@github.com\n');
  writeFileSync(
    join(realHome, '.config/git/credentials'),
    'https://worker:real-token@github.com\n',
  );
  writeFileSync(join(realHome, '.config/gh/hosts.yml'), 'github.com:\n  oauth_token: real-token\n');
  writeFileSync(
    join(realHome, '.gitconfig'),
    '[user]\n\tname = Operator\n\temail = operator@example.invalid\n[credential]\n\thelper = store\n',
  );
  writeFileSync(scratchGitConfig, '');
  writeFileSync(probeMarker, '');
  const repo = join(root, 'repo');
  mkdirSync(repo);
  const git = (cwd, ...args) =>
    execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-C', cwd, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  git(repo, 'init', '--initial-branch=lane/test');
  git(repo, 'config', 'user.email', 'worker@example.invalid');
  git(repo, 'config', 'user.name', 'Eval Worker');
  writeFileSync(join(repo, 'f.txt'), 'x');
  git(repo, 'add', 'f.txt');
  git(repo, 'commit', '-m', 'init');
  git(repo, 'remote', 'add', 'origin', 'https://github.com/xiechimon/cairn.git');
  writeFileSync(join(root, 'probe.cjs'), gatedCredentialReader());
  const base = {
    PATH: process.env.PATH,
    HOME: realHome,
    GH_CONFIG_DIR: join(realHome, '.config/gh'),
    GIT_CONFIG_GLOBAL: join(realHome, '.gitconfig'),
    CAIRN_EVAL_RELAY_KEY: 'relay-secret',
    CAIRN_PROBE_MARKER: probeMarker,
    GIT_TERMINAL_PROMPT: '0',
    TMPDIR: root,
  };
  writeFileSync(join(root, 'cairn-probe-git-credentials'), 'https://worker:tmp-token@github.com\n');
  const env = isolatedEvalEnv({
    home: scratchHome,
    ghConfigDir: ghConfig,
    gitConfig: scratchGitConfig,
    base,
  });
  await run('node', [join(root, 'probe.cjs')], { env });
  const seen = readFileSync(probeMarker, 'utf8');
  assert.ok(
    !JSON.parse(seen).seen.includes('gh_hosts=readable'),
    `evaluation read a credential file: ${seen}`,
  );
  assert.ok(!seen.includes('real-token'), 'evaluation exposed a stored token');
  assert.ok(!seen.includes('GH_TOKEN=set'), 'evaluation inherited a publication token');
  const tree = execFileSync('git', ['-C', repo, 'ls-tree', '-r', '--name-only', 'HEAD'], {
    encoding: 'utf8',
    env,
  });
  assert.equal(tree.trim(), 'f.txt');
  await assert.rejects(() =>
    run('git', ['-C', repo, 'push', 'origin', 'HEAD:refs/heads/lane/test'], { env }),
  );
});

test('a preloaded module cannot be used to reach the publication credential store', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'cairn-round1-preload-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const realHome = join(root, 'real-home');
  const scratchHome = join(root, 'scratch-home');
  const ghConfig = join(root, 'gh-config');
  const scratchGitConfig = join(root, 'scratch-gitconfig');
  const probeMarker = join(root, 'probe-marker');
  for (const dir of [
    join(realHome, '.config/gh'),
    join(realHome, '.config/git'),
    scratchHome,
    ghConfig,
  ]) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(join(realHome, '.config/gh/hosts.yml'), 'github.com:\n  oauth_token: real-token\n');
  writeFileSync(
    join(realHome, '.config/git/credentials'),
    'https://worker:real-token@github.com\n',
  );
  writeFileSync(join(realHome, 'probe-preload.cjs'), gatedCredentialReader());
  writeFileSync(scratchGitConfig, '');
  writeFileSync(probeMarker, '');
  const base = {
    PATH: process.env.PATH,
    HOME: realHome,
    GH_CONFIG_DIR: join(realHome, '.config/gh'),
    GIT_CONFIG_GLOBAL: join(realHome, '.gitconfig'),
    CAIRN_PROBE_MARKER: probeMarker,
    TMPDIR: root,
    NODE_OPTIONS: `--require ${join(realHome, 'probe-preload.cjs')}`,
  };
  const env = isolatedEvalEnv({
    home: scratchHome,
    ghConfigDir: ghConfig,
    gitConfig: scratchGitConfig,
    base,
  });
  await run('node', ['-e', '0'], { env });
  assert.equal(readFileSync(probeMarker, 'utf8'), '');
});

test('filesystem boundary denies absolute publication credentials and parent processes', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'cairn-boundary-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const checkout = join(root, 'checkout');
  const scratch = join(root, 'scratch');
  mkdirSync(checkout);
  mkdirSync(scratch);
  mkdirSync(join(checkout, '.git'));
  writeFileSync(join(checkout, '.git/config'), 'trusted');
  const secret = join(root, 'publisher-credentials');
  writeFileSync(secret, 'publication-secret');
  const script = join(checkout, 'probe.cjs');
  writeFileSync(
    script,
    `const fs = require('node:fs');
    const assert = require('node:assert/strict');
    assert.throws(() => fs.readFileSync(${JSON.stringify(secret)}));
    assert.throws(() => fs.readFileSync('/proc/${process.pid}/environ'));
    assert.throws(() => fs.writeFileSync(${JSON.stringify(join(checkout, '.git/config'))}, 'credential-helper'));
    fs.writeFileSync(${JSON.stringify(join(checkout, 'result'))}, 'isolated');`,
  );
  runIsolatedEvaluation({ checkout, scratch, args: [script], env: { PATH: '/usr/bin:/bin' } });
  assert.equal(readFileSync(join(checkout, 'result'), 'utf8'), 'isolated');
});

test('actual evaluator starts inside the boundary with checkout workspace sources', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'cairn-startup-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const checkout = join(root, 'checkout');
  const scratch = join(root, 'scratch');
  mkdirSync(checkout);
  mkdirSync(scratch);
  const trustedRoot = join(import.meta.dirname, '..');
  for (const path of ['integration', 'packages', 'apps', 'package.json', 'tsconfig.base.json']) {
    if (existsSync(join(trustedRoot, path)))
      cpSync(join(trustedRoot, path), join(checkout, path), {
        recursive: true,
        verbatimSymlinks: true,
        filter: (source) => !source.split('/').includes('node_modules'),
      });
  }
  const manifests = execFileSync('git', ['ls-files', '**/package.json', 'package.json'], {
    cwd: trustedRoot,
    encoding: 'utf8',
  })
    .trim()
    .split('\n');
  linkDependencies({ trustedRoot, checkout, scratch, dependencyManifests: manifests });
  linkWorkspaceDependencies({ trustedRoot, checkout, manifests, dependencyManifests: manifests });
  const source = join(checkout, 'packages/shared/src/index.ts');
  const original = readFileSync(source, 'utf8');
  writeFileSync(source, `${original}\nthrow new Error("evaluated-workspace-startup");\n`);
  assert.throws(
    () =>
      runIsolatedEvaluation({
        checkout,
        scratch,
        stdio: 'pipe',
        args: [
          '--import',
          join(checkout, 'integration/node_modules/tsx/dist/loader.mjs'),
          'integration/eval/chief-dispatch/run-eval.mts',
          '--help',
        ],
        env: { PATH: '/runtime:/usr/bin:/bin', HOME: '/tmp' },
      }),
    (error) => error.stderr?.toString().includes('evaluated-workspace-startup'),
  );
  writeFileSync(source, original);
  runIsolatedEvaluation({
    checkout,
    scratch,
    stdio: 'pipe',
    args: [
      '--import',
      join(checkout, 'integration/node_modules/tsx/dist/loader.mjs'),
      'integration/eval/chief-dispatch/run-eval.mts',
      '--help',
    ],
    env: { PATH: '/runtime:/usr/bin:/bin', HOME: '/tmp' },
  });
});
