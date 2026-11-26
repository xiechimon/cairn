import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
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
      '#!/bin/sh\ncat > /dev/null\nprintf \'%s\\n\' "$@" >> "$STUB_ARGS"\nprintf \'%s\\n\' "$STUB_LOG" >&2\nexit "$STUB_EXIT"\n',
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
  const { repo, base, argsFile, git, addCommit, stubbed } = fixture(t);
  addCommit('lane.txt', 'lane work\n');
  writeFileSync(join(repo, 'long-message'), 'a line of a long commit message\n'.repeat(20_000));
  git('commit', '-q', '--allow-empty', '-F', 'long-message');
  const run = stubbed({ exit: 0, log: 'INF no leaks found' });
  assert.equal(run.status, 0, run.stderr);
  const args = readFileSync(argsFile, 'utf8').split('\n');
  for (const expected of ['git', 'stdin', '--redact', '--ignore-gitleaks-allow'])
    assert.ok(args.includes(expected), expected);
  assert.ok(args.some((arg) => arg.startsWith('--log-opts=') && arg.includes(` ${base}..`)));
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

test('a local branch or tag named origin/main cannot move the start of the scan', (t) => {
  for (const shadow of ['branch', 'tag']) {
    const { base, git, argsFile, addCommit, stubbed } = fixture(t);
    addCommit('lane.txt', 'lane work\n');
    git(shadow, 'origin/main');
    assert.equal(stubbed({ exit: 0 }).status, 0);
    assert.ok(readFileSync(argsFile, 'utf8').includes(` ${base}..`), shadow);
  }
});

test('an ignore entry that may be a pasted secret is named by line number only', (t) => {
  const { addCommit, stubbed } = fixture(t);
  const pasted = generatedKey();
  addCommit('.gitleaksignore', `\n\n${pasted}\n`);
  const run = stubbed({ exit: 0 });
  assert.equal(run.status, 2);
  assert.equal(`${run.stdout}${run.stderr}`.includes(pasted), false);
  assert.match(run.stderr, /line 3 of .*must start with the commit.*rotate it first/is);
});

test('a shallow clone is scanned from its merge-base', (t) => {
  const { repo, git, addCommit, stubbed } = fixture(t);
  addCommit('main.txt', 'main\n');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  const main = git('rev-parse', 'HEAD');
  const cutOff = git('rev-parse', 'HEAD~1');
  writeFileSync(join(repo, '.git', 'shallow'), `${main}\n`);
  rmSync(join(repo, '.git', 'objects', cutOff.replace(/^(..)/, '$1/')));
  addCommit('lane.txt', 'lane work\n');
  const run = stubbed({ exit: 0 });
  assert.equal(run.status, 0, run.stderr);
});

test('started through a symlinked path it still scans instead of exiting quietly', (t) => {
  const { repo, bin, git } = fixture(t);
  git('update-ref', '-d', 'refs/remotes/origin/main');
  const link = join(bin, 'scan-link.mjs');
  symlinkSync(SCRIPT, link);
  for (const flags of [[], ['--preserve-symlinks-main']]) {
    const run = spawnSync(process.execPath, [...flags, link], { cwd: repo, encoding: 'utf8' });
    assert.equal(run.status, 2, `${flags} ${run.stdout}${run.stderr}`);
  }
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
  'a file git treats as binary': ({ addCommit }, line) => addCommit('key.txt', `\0${line}`),
  'a textconv filter': ({ git, addCommit }, line) => {
    git('config', 'diff.mask.textconv', 'echo masked #');
    addCommit('.gitattributes', '*.txt diff=mask\n');
    addCommit('key.txt', line);
  },
  'a replace ref over the commit': ({ git, addCommit }, line) => {
    git('commit', '-q', '--allow-empty', '-m', line);
    git('replace', 'HEAD', git('commit-tree', 'HEAD^{tree}', '-p', 'HEAD~1', '-m', 'clean'));
    addCommit('clean.txt', 'clean\n');
  },
  'i18n.logOutputEncoding=UTF-16': ({ git }, line) => {
    git('commit', '-q', '--allow-empty', '-m', line);
    git('config', 'i18n.logOutputEncoding', 'UTF-16');
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
  const silent = "title = \"x\"\n[[rules]]\nid = \"never\"\nregex = '''never-matches-zzz'''\n";
  addCommit('.gitleaks.toml', silent);
  addCommit('key.txt', `token = "${token}"\n`);
  refusesWithoutPrinting(scan({ GITLEAKS_CONFIG_TOML: silent }), token);
});

test('only a committed ignore entry that names its commit is honoured', realGitleaks, (t) => {
  const { repo, git, addCommit, scan } = fixture(t);
  const token = generatedKey();
  git('config', 'log.date', 'relative');
  addCommit('key.txt', `token = "${token}"\n`);
  const found = scan({ GIT_CONFIG_PARAMETERS: "'log.date'='human'" });
  refusesWithoutPrinting(found, token);
  const [fingerprint] = found.stdout.match(/[0-9a-f]{40}:key\.txt:github-pat:1/) ?? [];
  assert.ok(fingerprint, found.stdout);

  writeFileSync(join(repo, '.gitleaksignore'), `${fingerprint}\n`);
  assert.equal(scan().status, 1);
  addCommit('.gitleaksignore', `# reviewed\n${fingerprint}\n`);
  const ignored = scan();
  assert.equal(ignored.status, 0, `${ignored.stdout}${ignored.stderr}`);

  for (const unpinned of ['key.txt:github-pat:1', ':github-pat:2']) {
    addCommit('.gitleaksignore', `${unpinned}\n`);
    const refused = scan();
    assert.equal(refused.status, 2);
    assert.match(refused.stderr, /must start with the commit/);
  }
});

test('a key in a commit message is traced to its commit', realGitleaks, (t) => {
  const { git, addCommit, scan } = fixture(t);
  const token = generatedKey();
  git('commit', '-q', '--allow-empty', '-m', `fix\n\n${token}`);
  const guilty = git('rev-parse', 'HEAD');
  addCommit('later.txt', 'later\n');
  const run = scan();
  refusesWithoutPrinting(run, token);
  assert.match(run.stderr, new RegExp(`message of ${guilty}.*reword`, 's'));
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
