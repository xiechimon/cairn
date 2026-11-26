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
      '#!/bin/sh\nprintf \'%s\\n\' "$@" >> "$STUB_ARGS"\nprintf \'%s\\n\' "$STUB_LOG" >&2\nexit "$STUB_EXIT"\n',
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
  for (const expected of ['git', 'stdin', '--redact', '--ignore-gitleaks-allow'])
    assert.ok(args.includes(expected), expected);
  assert.ok(args.some((arg) => arg.startsWith('--log-opts=') && arg.endsWith(` ${base}..HEAD`)));
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

const realGitleaks = { skip: !hasGitleaks && 'gitleaks is not installed' };

const generatedKey = () =>
  `ghp_${randomBytes(48)
    .toString('base64')
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 36)}`;

function refusesWithoutPrinting(run, token) {
  assert.equal(run.status, 1, `${run.stdout}${run.stderr}`);
  assert.equal(`${run.stdout}${run.stderr}`.includes(token), false);
}

test(
  'the installed gitleaks refuses a generated key without printing it, and passes clean commits',
  realGitleaks,
  (t) => {
    const { addCommit, scan } = fixture(t);
    addCommit('clean.txt', 'nothing to find\n');
    const clean = scan();
    assert.equal(clean.status, 0, clean.stderr);

    const token = generatedKey();
    addCommit('key.txt', `token = "${token}" # gitleaks:allow\n`);
    const refused = scan();
    refusesWithoutPrinting(refused, token);
    assert.match(refused.stdout, /key\.txt/);
  },
);

const hidingPlaces = {
  'color.ui=always': ({ git, addCommit }, line) => {
    git('config', 'color.ui', 'always');
    addCommit('key.txt', line);
  },
  'a file git treats as binary': ({ addCommit }, line) => addCommit('key.txt', `\0${line}`),
  'a -diff attribute': ({ addCommit }, line) => {
    addCommit('.gitattributes', '*.txt -diff\n');
    addCommit('key.txt', line);
  },
  'a textconv filter': ({ git, addCommit }, line) => {
    git('config', 'diff.mask.textconv', 'echo masked #');
    addCommit('.gitattributes', '*.txt diff=mask\n');
    addCommit('key.txt', line);
  },
  'a replace ref': ({ repo, git, addCommit }, line) => {
    addCommit('key.txt', line);
    writeFileSync(join(repo, 'clean-blob'), 'nothing\n');
    git('replace', git('rev-parse', 'HEAD:key.txt'), git('hash-object', '-w', 'clean-blob'));
  },
  'text added only by a merge commit': ({ repo, git, addCommit }, line) => {
    git('checkout', '-qb', 'side');
    addCommit('side.txt', 'side\n');
    git('checkout', '-q', 'main');
    addCommit('mine.txt', 'mine\n');
    git('merge', '-q', '--no-ff', '--no-commit', 'side');
    writeFileSync(join(repo, 'key.txt'), line);
    git('add', '--', 'key.txt');
    git('commit', '-qm', 'merge side');
  },
  'a commit message': ({ git }, line) => git('commit', '-q', '--allow-empty', '-m', line),
};

for (const [place, hide] of Object.entries(hidingPlaces))
  test(`the installed gitleaks reads a key behind ${place}`, realGitleaks, (t) => {
    const fx = fixture(t);
    const token = generatedKey();
    hide(fx, `token = "${token}"\n`);
    refusesWithoutPrinting(fx.scan(), token);
  });

test('merging origin/main does not rescan what main already holds', realGitleaks, (t) => {
  const { base, git, addCommit, scan } = fixture(t);
  addCommit('already-on-main.txt', `token = "${generatedKey()}"\n`);
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('checkout', '-qb', 'lane', base);
  addCommit('lane.txt', 'lane work\n');
  git('merge', '-q', '--no-ff', '-m', 'merge main', 'origin/main');
  const run = scan();
  assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
});

test('no gitleaks configuration can switch the rules off', realGitleaks, (t) => {
  const { addCommit, scan } = fixture(t);
  const token = generatedKey();
  addCommit('key.txt', `token = "${token}"\n`);
  const silent = "title = \"x\"\n[[rules]]\nid = \"never\"\nregex = '''never-matches-zzz'''\n";
  refusesWithoutPrinting(scan({ GITLEAKS_CONFIG_TOML: silent }), token);

  addCommit('.gitleaks.toml', silent);
  const configured = scan();
  assert.equal(configured.status, 2);
  assert.match(configured.stderr, /\.gitleaks\.toml.*\.gitleaksignore/s);
});

test('a merge with more than two parents is red, because its own text is not shown', (t) => {
  const { base, git, addCommit, stubbed } = fixture(t);
  for (const branch of ['one', 'two']) {
    git('checkout', '-qb', branch, base);
    addCommit(`${branch}.txt`, `${branch}\n`);
  }
  git('checkout', '-q', 'main');
  addCommit('mine.txt', 'mine\n');
  git('merge', '-q', '--no-ff', '-m', 'octopus', 'one', 'two');
  const run = stubbed({ exit: 0 });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /more than two parents/);
});
