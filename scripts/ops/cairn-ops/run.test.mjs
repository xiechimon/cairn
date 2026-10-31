import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runTask, validateConfig, validateTree, wrapperScript } from './run.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const gitPath = execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
const flockPath = ['/usr/bin/flock', '/bin/flock'].find((path) => existsSync(path));
const bases = [];

after(() => {
  for (const base of bases) rmSync(base, { recursive: true, force: true });
});

function git(cwd, ...args) {
  return execFileSync(gitPath, args, {
    cwd,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: cwd,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
    },
  }).trim();
}

function taskScript(out) {
  return `printf '%s\\n' "$@" > '${out}/args'\nenv > '${out}/env'\nfind . | sort > '${out}/files'\nexit "\${DEMO_EXIT:-0}"\n`;
}

function fixture({ trustedUid = process.getuid(), tasks } = {}) {
  const base = mkdtempSync(join(homedir(), '.cairn-ops-test-'));
  bases.push(base);
  const out = join(base, 'out');
  mkdirSync(out);
  const upstream = join(base, 'upstream');
  mkdirSync(upstream);
  git(upstream, 'init', '-q', '-b', 'main');
  mkdirSync(join(upstream, 'scripts/ops/demo/lib'), { recursive: true });
  writeFileSync(join(upstream, 'scripts/ops/demo/task.sh'), taskScript(out));
  writeFileSync(join(upstream, 'scripts/ops/demo/lib/data.txt'), 'payload\n');
  writeFileSync(join(upstream, 'outside.sh'), 'exit 0\n');
  git(upstream, 'add', '.');
  git(upstream, 'commit', '-q', '-m', 'main');
  const mainSha = git(upstream, 'rev-parse', 'HEAD');
  git(upstream, 'switch', '-q', '-c', 'side');
  writeFileSync(join(upstream, 'scripts/ops/demo/task.sh'), `touch '${out}/side-ran'\n`);
  git(upstream, 'commit', '-q', '-am', 'side');
  const sideSha = git(upstream, 'rev-parse', 'HEAD');
  git(upstream, 'switch', '-q', 'main');

  const layout = {
    runner: join(base, 'sbin/cairn-ops-run'),
    module: join(base, 'lib/run.mjs'),
    config: join(base, 'etc/tasks.json'),
    state: join(base, 'state'),
    mirror: join(base, 'state/cairn.git'),
    work: join(base, 'state/work'),
    lock: join(base, 'state/run.lock'),
    log: join(base, 'log/run.log'),
    git: gitPath,
    node: process.execPath,
    flock: flockPath,
    env: '/usr/bin/env',
    taskPath: '/usr/bin:/bin',
    taskHome: base,
  };
  mkdirSync(dirname(layout.module), { recursive: true });
  copyFileSync(join(here, 'run.mjs'), layout.module);
  writeFileSync(join(dirname(layout.module), 'layout.json'), JSON.stringify(layout));
  layout.trustedUid = trustedUid;
  mkdirSync(dirname(layout.runner), { recursive: true });
  writeFileSync(layout.runner, flockPath ? wrapperScript(layout) : '#!/bin/sh\nexit 2\n', {
    mode: 0o755,
  });
  mkdirSync(dirname(layout.config), { recursive: true });
  mkdirSync(layout.state, { mode: 0o700 });
  mkdirSync(layout.work, { mode: 0o700 });
  mkdirSync(dirname(layout.log), { recursive: true });
  git(base, 'init', '-q', '--bare', layout.mirror);
  const config = {
    source: { url: `file://${upstream}`, branch: 'main' },
    tasks: tasks ?? {
      demo: {
        directory: 'scripts/ops/demo',
        interpreter: '/bin/sh',
        entry: 'task.sh',
        args: ['--fixed'],
        env: { DEMO_EXIT: '[0-9]{1,3}', CAIRN_ORB_NODE_MAJOR: '[1-9][0-9]' },
      },
    },
  };
  writeFileSync(layout.config, `${JSON.stringify(config, null, 2)}\n`);
  return { base, out, upstream, layout, mainSha, sideSha, config };
}

function run(layout, argv) {
  const messages = [];
  const code = runTask(argv, layout, { stdio: 'ignore', report: (line) => messages.push(line) });
  return { code, messages: messages.join('\n') };
}

function logLines(layout) {
  return readFileSync(layout.log, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}

function commitTree(upstream, mutate) {
  const demo = git(upstream, 'ls-tree', 'HEAD:scripts/ops/demo');
  const blob = git(upstream, 'hash-object', '-w', 'outside.sh');
  const demoTree = execFileSync(gitPath, ['mktree'], {
    cwd: upstream,
    input: `${mutate(demo, blob)}\n`,
    encoding: 'utf8',
  }).trim();
  const opsTree = execFileSync(gitPath, ['mktree'], {
    cwd: upstream,
    input: `040000 tree ${demoTree}\tdemo\n`,
    encoding: 'utf8',
  }).trim();
  const scriptsTree = execFileSync(gitPath, ['mktree'], {
    cwd: upstream,
    input: `040000 tree ${opsTree}\tops\n`,
    encoding: 'utf8',
  }).trim();
  const rootTree = execFileSync(gitPath, ['mktree'], {
    cwd: upstream,
    input: `040000 tree ${scriptsTree}\tscripts\n`,
    encoding: 'utf8',
  }).trim();
  const commit = git(upstream, 'commit-tree', rootTree, '-p', 'HEAD', '-m', 'crafted');
  git(upstream, 'update-ref', 'refs/heads/main', commit);
  return commit;
}

test('runs the task from a main commit with fixed argv and clean env, and logs start and end', () => {
  const { out, layout, mainSha } = fixture();
  const { code, messages } = run(layout, ['demo', mainSha, '--dry-run']);
  assert.equal(code, 0, messages);
  assert.equal(readFileSync(join(out, 'args'), 'utf8'), '--fixed\n--dry-run\n');
  const env = readFileSync(join(out, 'env'), 'utf8');
  assert.match(env, /^PATH=\/usr\/bin:\/bin$/m);
  assert.match(env, new RegExp(`^CAIRN_OPS_COMMIT=${mainSha}$`, 'm'));
  assert.match(env, /^CAIRN_OPS_TASK=demo$/m);
  const lines = logLines(layout);
  assert.deepEqual(
    lines.map((line) => [line.event, line.task, line.commit, line.exit]),
    [
      ['start', 'demo', mainSha, undefined],
      ['end', 'demo', mainSha, 0],
    ],
  );
  assert.deepEqual(lines[1].argv, ['demo', mainSha, '--dry-run']);
  assert.ok(lines[1].startedAt && lines[1].endedAt);
  assert.deepEqual(readdirSync(layout.work), []);
});

test('materializes the whole task directory and nothing outside it', () => {
  const { out, layout, mainSha } = fixture();
  const { code, messages } = run(layout, ['demo', mainSha]);
  assert.equal(code, 0, messages);
  assert.deepEqual(readFileSync(join(out, 'files'), 'utf8').trim().split('\n'), [
    '.',
    './scripts',
    './scripts/ops',
    './scripts/ops/demo',
    './scripts/ops/demo/lib',
    './scripts/ops/demo/lib/data.txt',
    './scripts/ops/demo/task.sh',
  ]);
});

test('refuses a full SHA that exists in the mirror but is not reachable from main', () => {
  const { out, layout, sideSha, upstream } = fixture();
  git(layout.mirror, 'fetch', '-q', `file://${upstream}`, 'side:refs/heads/side');
  const { code, messages } = run(layout, ['demo', sideSha]);
  assert.equal(code, 2);
  assert.match(messages, /not reachable from origin\/main/);
  assert.equal(existsSync(join(out, 'side-ran')), false);
  const end = logLines(layout).at(-1);
  assert.equal(end.event, 'end');
  assert.equal(end.exit, 2);
  assert.match(end.refused, /not reachable/);
});

test('refuses short, uppercase, unknown and non-commit SHAs', () => {
  const { layout, mainSha, upstream } = fixture();
  const treeSha = git(upstream, 'rev-parse', 'HEAD^{tree}');
  for (const sha of [
    mainSha.slice(0, 12),
    mainSha.toUpperCase(),
    `${mainSha}0`,
    'f'.repeat(40),
    treeSha,
    'main',
    'HEAD',
  ]) {
    const { code, messages } = run(layout, ['demo', sha]);
    assert.equal(code, 2, sha);
    assert.match(messages, /refused/, sha);
  }
});

test('refuses tasks that are not in the configuration', () => {
  const { layout, mainSha } = fixture();
  for (const task of ['missing', '__proto__', 'constructor', 'toString', '../demo', 'Demo']) {
    const { code, messages } = run(layout, [task, mainSha]);
    assert.equal(code, 2, task);
    assert.match(messages, /unknown task|invalid task/, task);
  }
});

test('refuses malformed invocations', () => {
  const { layout, mainSha } = fixture();
  for (const argv of [
    [],
    ['demo'],
    ['demo', mainSha, '--force'],
    ['demo', mainSha, '--dry-run', '--dry-run'],
    ['demo', mainSha, 'extra'],
    ['demo', mainSha, '--env'],
  ]) {
    const { code } = run(layout, argv);
    assert.equal(code, 2, argv.join(' '));
  }
});

test('refuses a task tree containing a symlink', () => {
  const { out, layout, upstream } = fixture();
  const sha = commitTree(upstream, (demo, blob) => `${demo}\n120000 blob ${blob}\tlink`);
  const { code, messages } = run(layout, ['demo', sha]);
  assert.equal(code, 2);
  assert.match(messages, /unsupported entry mode 120000/);
  assert.equal(existsSync(join(out, 'args')), false);
});

test('refuses a task tree containing a submodule', () => {
  const { layout, upstream, mainSha } = fixture();
  const sha = commitTree(upstream, (demo) => `${demo}\n160000 commit ${mainSha}\tmodule`);
  const { code, messages } = run(layout, ['demo', sha]);
  assert.equal(code, 2);
  assert.match(messages, /unsupported entry mode 160000/);
});

test('refuses a task tree with a parent-directory entry', () => {
  const { out, layout, upstream } = fixture();
  const sha = commitTree(upstream, (demo, blob) => `${demo}\n100644 blob ${blob}\t..`);
  const { code, messages } = run(layout, ['demo', sha]);
  assert.equal(code, 2);
  assert.match(messages, /unsafe path/);
  assert.equal(existsSync(join(out, 'args')), false);
});

test('tree validation rejects traversal, git metadata and paths outside the task directory', () => {
  const blob = { mode: '100644', type: 'blob', oid: 'a'.repeat(40) };
  for (const path of [
    'scripts/ops/demo/../x',
    'scripts/ops/demo/./x',
    'scripts/ops/demo//x',
    'scripts/ops/demo/.git/config',
    'scripts/ops/demo/sub/.GIT',
    'scripts/ops/demoX/task.sh',
    'scripts/ops/other/task.sh',
    '/etc/passwd',
  ]) {
    assert.throws(
      () => validateTree([{ ...blob, path }], 'scripts/ops/demo', 'task.sh'),
      /unsafe path|outside/,
      path,
    );
  }
  assert.throws(
    () =>
      validateTree([{ ...blob, path: 'scripts/ops/demo/lib/x' }], 'scripts/ops/demo', 'task.sh'),
    /entry task.sh missing/,
  );
  assert.throws(
    () =>
      validateTree(
        [{ mode: '100644', type: 'tree', oid: 'a'.repeat(40), path: 'scripts/ops/demo/task.sh' }],
        'scripts/ops/demo',
        'task.sh',
      ),
    /unsupported/,
  );
});

test('refuses when the task directory does not exist at the commit', () => {
  const { layout, mainSha } = fixture({
    tasks: {
      demo: {
        directory: 'scripts/ops/absent',
        interpreter: '/bin/sh',
        entry: 'task.sh',
        args: [],
        env: {},
      },
    },
  });
  const { code, messages } = run(layout, ['demo', mainSha]);
  assert.equal(code, 2);
  assert.match(messages, /entry task.sh missing/);
});

test('ignores injected caller environment and passes only allowlisted --env values', () => {
  const { out, base, layout, mainSha } = fixture();
  const marker = join(base, 'bash-env-ran');
  const bashEnv = join(base, 'evil.sh');
  writeFileSync(bashEnv, `touch '${marker}'\n`);
  const injected = {
    PATH: `${base}/evil-bin`,
    NODE_OPTIONS: '--no-warnings',
    LD_PRELOAD: `${base}/evil.so`,
    LD_LIBRARY_PATH: `${base}/evil`,
    BASH_ENV: bashEnv,
    ENV: bashEnv,
    CAIRN_ORB_NODE_MAJOR: '99',
    DEMO_EXIT: '9',
  };
  const saved = Object.fromEntries(Object.keys(injected).map((key) => [key, process.env[key]]));
  Object.assign(process.env, injected);
  let result;
  try {
    const bash = existsSync('/usr/bin/bash') ? '/usr/bin/bash' : '/bin/bash';
    const config = JSON.parse(readFileSync(layout.config, 'utf8'));
    config.tasks.demo.interpreter = bash;
    writeFileSync(layout.config, JSON.stringify(config));
    result = run(layout, ['demo', mainSha, '--env', 'CAIRN_ORB_NODE_MAJOR=26']);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  assert.equal(result.code, 0, result.messages);
  const env = readFileSync(join(out, 'env'), 'utf8');
  for (const name of [
    'NODE_OPTIONS',
    'LD_PRELOAD',
    'LD_LIBRARY_PATH',
    'BASH_ENV',
    'ENV',
    'DEMO_EXIT',
  ])
    assert.doesNotMatch(env, new RegExp(`^${name}=`, 'm'), name);
  assert.match(env, /^PATH=\/usr\/bin:\/bin$/m);
  assert.match(env, /^CAIRN_ORB_NODE_MAJOR=26$/m);
  assert.equal(existsSync(marker), false);
});

test('refuses --env names outside the task allowlist and values that do not match', () => {
  const { layout, mainSha } = fixture();
  for (const pair of [
    'PATH=/tmp',
    'NODE_OPTIONS=--require=x',
    'LD_PRELOAD=x',
    'BASH_ENV=x',
    'CAIRN_ORB_NODE_MAJOR=2',
    'CAIRN_ORB_NODE_MAJOR=26;id',
    'CAIRN_ORB_NODE_MAJOR=26\nX=1',
    'CAIRN_ORB_NODE_MAJOR',
    '=26',
  ]) {
    const { code, messages } = run(layout, ['demo', mainSha, '--env', pair]);
    assert.equal(code, 2, pair);
    assert.match(messages, /refused/, pair);
  }
  const { code } = run(layout, [
    'demo',
    mainSha,
    '--env',
    'CAIRN_ORB_NODE_MAJOR=26',
    '--env',
    'CAIRN_ORB_NODE_MAJOR=24',
  ]);
  assert.equal(code, 2);
});

test('refuses group- or world-writable runner, module, config, state, log or interpreter paths', () => {
  for (const pick of [
    (layout) => layout.runner,
    (layout) => layout.config,
    (layout) => dirname(layout.config),
    (layout) => layout.state,
    (layout) => layout.mirror,
    (layout) => dirname(layout.log),
  ]) {
    const { layout, mainSha } = fixture();
    const target = pick(layout);
    chmodSync(target, 0o777);
    const { code, messages } = run(layout, ['demo', mainSha]);
    assert.equal(code, 2, target);
    assert.match(messages, /writable by group or others/, target);
    chmodSync(target, 0o755);
  }
  const { base, layout, mainSha } = fixture();
  const interpreter = join(base, 'sh');
  writeFileSync(interpreter, '#!/bin/sh\n', { mode: 0o775 });
  chmodSync(interpreter, 0o775);
  const config = JSON.parse(readFileSync(layout.config, 'utf8'));
  config.tasks.demo.interpreter = interpreter;
  writeFileSync(layout.config, JSON.stringify(config));
  const { code, messages } = run(layout, ['demo', mainSha]);
  assert.equal(code, 2);
  assert.match(messages, /writable by group or others/);
});

test('refuses to run anything when its files live in a checkout not owned by the trusted user', () => {
  const { out, layout, mainSha } = fixture({ trustedUid: process.getuid() + 1 });
  const { code, messages } = run(layout, ['demo', mainSha]);
  assert.equal(code, 2);
  assert.match(messages, /not owned by uid/);
  assert.equal(existsSync(join(out, 'args')), false);
});

test('refuses a configuration with unsafe or unknown fields', () => {
  const good = {
    source: { url: 'https://github.com/xiechimon/cairn.git', branch: 'main' },
    tasks: {
      demo: {
        directory: 'scripts/ops/demo',
        interpreter: '/bin/sh',
        entry: 'task.sh',
        args: [],
        env: {},
      },
    },
  };
  assert.doesNotThrow(() => validateConfig(good));
  const variants = [
    { ...good, extra: 1 },
    { ...good, source: { ...good.source, url: 'ext::sh -c id' } },
    { ...good, source: { ...good.source, branch: '--upload-pack=id' } },
    { ...good, tasks: { demo: { ...good.tasks.demo, directory: 'scripts/../etc' } } },
    { ...good, tasks: { demo: { ...good.tasks.demo, directory: '/etc' } } },
    { ...good, tasks: { demo: { ...good.tasks.demo, entry: '../task.sh' } } },
    { ...good, tasks: { demo: { ...good.tasks.demo, interpreter: 'sh' } } },
    { ...good, tasks: { demo: { ...good.tasks.demo, env: { LD_PRELOAD: '.*' } } } },
    { ...good, tasks: { demo: { ...good.tasks.demo, env: { NODE_OPTIONS: '.*' } } } },
    { ...good, tasks: { demo: { ...good.tasks.demo, env: { BASH_ENV: '.*' } } } },
    { ...good, tasks: { demo: { ...good.tasks.demo, env: { PATH: '.*' } } } },
    { ...good, tasks: { demo: { ...good.tasks.demo, env: { CAIRN_OPS_COMMIT: '.*' } } } },
    { ...good, tasks: { demo: { ...good.tasks.demo, args: [1] } } },
    { ...good, tasks: { demo: { ...good.tasks.demo, shell: true } } },
    { ...good, tasks: { 'Bad Name': good.tasks.demo } },
  ];
  for (const variant of variants)
    assert.throws(() => validateConfig(variant), JSON.stringify(variant));
});

test('propagates task failure and still logs the end record', () => {
  const { layout, mainSha } = fixture();
  const { code } = run(layout, ['demo', mainSha, '--env', 'DEMO_EXIT=7']);
  assert.equal(code, 7);
  const end = logLines(layout).at(-1);
  assert.equal(end.exit, 7);
  assert.deepEqual(readdirSync(layout.work), []);
});

test('refuses and logs when main cannot be fetched', () => {
  const { base, layout, mainSha } = fixture();
  const config = JSON.parse(readFileSync(layout.config, 'utf8'));
  config.source.url = `file://${base}/missing`;
  writeFileSync(layout.config, JSON.stringify(config));
  const { code, messages } = run(layout, ['demo', mainSha]);
  assert.equal(code, 2);
  assert.match(messages, /fetch/);
  assert.equal(logLines(layout).at(-1).exit, 2);
});

test('refuses without writing anything when the log directory is untrusted', () => {
  const { layout, mainSha } = fixture();
  chmodSync(dirname(layout.log), 0o777);
  const { code, messages } = run(layout, ['demo', mainSha]);
  assert.equal(code, 2);
  assert.match(messages, /writable by group or others/);
  assert.equal(existsSync(layout.log), false);
  chmodSync(dirname(layout.log), 0o755);
});

test('the wrapper clears the caller environment and serializes concurrent runs', {
  skip: !flockPath,
}, async () => {
  const { out, layout, upstream } = fixture();
  writeFileSync(
    join(upstream, 'scripts/ops/demo/task.sh'),
    `echo "start $$ $(date +%s%N)" >> '${out}/timeline'\nsleep 1\nenv > '${out}/env'\necho "end $$ $(date +%s%N)" >> '${out}/timeline'\n`,
  );
  git(upstream, 'commit', '-q', '-am', 'slow');
  const sha = git(upstream, 'rev-parse', 'HEAD');
  const launch = () =>
    new Promise((resolve) => {
      const child = spawn('/bin/sh', [layout.runner, 'demo', sha], {
        env: {
          ...process.env,
          NODE_OPTIONS: '--require=/nonexistent/evil.cjs',
          BASH_ENV: '/nonexistent',
        },
        stdio: 'ignore',
      });
      child.on('exit', resolve);
    });
  const codes = await Promise.all([launch(), launch()]);
  assert.deepEqual(codes, [0, 0]);
  const timeline = readFileSync(join(out, 'timeline'), 'utf8').trim().split('\n');
  assert.deepEqual(
    timeline.map((line) => line.split(' ')[0]),
    ['start', 'end', 'start', 'end'],
  );
  assert.doesNotMatch(readFileSync(join(out, 'env'), 'utf8'), /NODE_OPTIONS|BASH_ENV/);
  assert.equal(spawnSync('/bin/sh', ['-n', layout.runner]).status, 0);
});
