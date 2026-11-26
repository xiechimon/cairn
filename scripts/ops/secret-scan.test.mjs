import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { delimiter, join } from 'node:path';
import test from 'node:test';
import { makeTestTempDir, releaseTestTempDir } from '../test-tmpdir.mjs';

const SCRIPT = join(import.meta.dirname, 'secret-scan.mjs');
const hasGitleaks = spawnSync('gitleaks', ['version']).status === 0;
const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();

function fixture(t) {
  const root = makeTestTempDir('secret-scan-');
  t.after(() => releaseTestTempDir(root));
  const repo = join(root, 'repo');
  mkdirSync(repo);
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  const addCommit = (name, text) => {
    writeFileSync(join(repo, name), text);
    git('add', '--', name);
    git('commit', '-qm', `add ${name}`);
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  addCommit('base.txt', 'base\n');
  const base = git('rev-parse', 'HEAD');
  git('update-ref', 'refs/remotes/origin/main', base);
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const argsFile = join(root, 'args');
  const scan = (env = {}) =>
    spawnSync(process.execPath, [SCRIPT], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, ...env },
    });
  const stubbed = ({ exit, log = '' }) => {
    writeFileSync(
      join(bin, 'gitleaks'),
      '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$STUB_ARGS"\nprintf \'%s\\n\' "$STUB_LOG" >&2\nexit "$STUB_EXIT"\n',
    );
    chmodSync(join(bin, 'gitleaks'), 0o755);
    return scan({
      PATH: `${bin}${delimiter}${process.env.PATH}`,
      STUB_ARGS: argsFile,
      STUB_LOG: log,
      STUB_EXIT: String(exit),
    });
  };
  return { repo, base, bin, argsFile, git, addCommit, scan, stubbed };
}

test('scans exactly the commits since origin/main, redacted, with inline allows ignored', (t) => {
  const { base, argsFile, stubbed } = fixture(t);
  const run = stubbed({ exit: 0, log: 'INF no leaks found' });
  assert.equal(run.status, 0, run.stderr);
  const args = readFileSync(argsFile, 'utf8').split('\n');
  for (const expected of ['git', '--redact', '--ignore-gitleaks-allow', `--log-opts=${base}..HEAD`])
    assert.ok(args.includes(expected), expected);
});

test('a finding is red and says to rotate before removing it', (t) => {
  const run = fixture(t).stubbed({ exit: 1, log: 'WRN leaks found: 1' });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /rotate it first.*then remove it/is);
  assert.match(run.stderr, /\.gitleaksignore/);
});

test('a scan that could not run is red, even when gitleaks exits 0', (t) => {
  const { stubbed } = fixture(t);
  const swallowed = stubbed({
    exit: 0,
    log: 'ERR error="stderr is not empty"\nINF no leaks found',
  });
  assert.equal(swallowed.status, 2);
  assert.match(swallowed.stderr, /not fully scanned/);
  assert.equal(stubbed({ exit: 126 }).status, 2);
});

test('no merge-base is red before gitleaks runs', (t) => {
  const { git, argsFile, stubbed } = fixture(t);
  git('update-ref', '-d', 'refs/remotes/origin/main');
  const run = stubbed({ exit: 0 });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /no merge-base with origin\/main/);
  assert.equal(existsSync(argsFile), false);
});

test('a missing gitleaks is red and says how to install it', (t) => {
  const { bin, scan } = fixture(t);
  symlinkSync(realGit, join(bin, 'git'));
  const run = scan({ PATH: bin });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /not installed.*brew install gitleaks/is);
});

test('the installed gitleaks refuses a generated key without printing it, and passes clean commits', {
  skip: !hasGitleaks && 'gitleaks is not installed',
}, (t) => {
  const { addCommit, scan } = fixture(t);
  addCommit('clean.txt', 'nothing to find\n');
  const clean = scan();
  assert.equal(clean.status, 0, clean.stderr);

  const token = `ghp_${randomBytes(48)
    .toString('base64')
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 36)}`;
  addCommit('key.txt', `token = "${token}" # gitleaks:allow\n`);
  const refused = scan();
  assert.equal(refused.status, 1, refused.stderr);
  assert.match(refused.stdout, /key\.txt/);
  assert.equal(`${refused.stdout}${refused.stderr}`.includes(token), false);
});
