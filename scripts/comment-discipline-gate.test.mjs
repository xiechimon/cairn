import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

const script = resolve('scripts/comment-discipline-gate.mjs');

test('checks only added source comment lines and exact allowlist entries', () => {
  const cwd = mkdtempSync(resolve(tmpdir(), 'comment-gate-'));
  const git = (...args) => execFileSync('git', args, { cwd, stdio: 'pipe' });
  const run = () =>
    spawnSync(process.execPath, [script], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, COMMENT_DISCIPLINE_BASE_SHA: '' },
    });
  try {
    git('init');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    mkdirSync(resolve(cwd, 'apps/demo'), { recursive: true });
    mkdirSync(resolve(cwd, 'scripts'));
    writeFileSync(resolve(cwd, 'scripts/comment-discipline-allowlist.json'), '[]');
    const file = resolve(cwd, 'apps/demo/code.ts');
    writeFileSync(file, '// existing\n/* existing block\nold text\n*/\nconst x = 1;\n');
    git('add', 'apps/demo/code.ts', 'scripts/comment-discipline-allowlist.json');
    git('commit', '-m', 'baseline');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    assert.equal(run().status, 0);
    for (const addition of ['// added', '/* added */', '/** API */', '{/* JSX */}']) {
      writeFileSync(file, `// existing\n${addition}\n`);
      const result = run();
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /apps\/demo\/code.ts:2/);
    }
    writeFileSync(file, '// existing\n/* existing block\nnew text\n*/\nconst x = 1;\n');
    assert.equal(run().status, 1);
    writeFileSync(file, '// existing\nconst url = "https://example.com";\n');
    assert.equal(run().status, 0);
    writeFileSync(file, '// existing\n// Browser quirk\n');
    writeFileSync(
      resolve(cwd, 'scripts/comment-discipline-allowlist.json'),
      JSON.stringify([
        {
          path: 'apps/demo/code.ts',
          line: '// Browser quirk',
          reason: 'External browser behavior',
        },
      ]),
    );
    assert.equal(run().status, 0);
    writeFileSync(file, '// existing\n// Browser quirk changed\n');
    assert.equal(run().status, 1);
    git('add', 'apps/demo/code.ts');
    git('commit', '-m', 'added comment');
    assert.equal(run().status, 1);
    git('update-ref', '-d', 'refs/remotes/origin/main');
    assert.equal(run().status, 2);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

function revertFixture(t) {
  const cwd = mkdtempSync(resolve(tmpdir(), 'comment-gate-revert-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
  const run = (base = '') =>
    spawnSync(process.execPath, [script], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, COMMENT_DISCIPLINE_BASE_SHA: base },
    });
  const file = resolve(cwd, 'apps/demo/code.ts');
  const other = resolve(cwd, 'apps/demo/other.ts');
  git('init', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  mkdirSync(resolve(cwd, 'apps/demo'), { recursive: true });
  mkdirSync(resolve(cwd, 'scripts'));
  writeFileSync(resolve(cwd, 'scripts/comment-discipline-allowlist.json'), '[]');
  writeFileSync(file, '// legacy note\nconst x = 1;\n');
  writeFileSync(other, '// other note\nconst y = 1;\n');
  git('add', '.');
  git('commit', '-m', 'legacy comments');
  writeFileSync(file, 'const x = 1;\n');
  git('commit', '-am', 'strip comments');
  const strip = git('rev-parse', 'HEAD');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  return { cwd, git, run, file, other, strip };
}

test('an exact revert of a main commit that re-adds comments passes', (t) => {
  const f = revertFixture(t);
  f.git('checkout', '-b', 'feature');
  f.git('revert', '--no-edit', f.strip);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
});

test('a revert with one extra changed line still fails', (t) => {
  const f = revertFixture(t);
  f.git('checkout', '-b', 'feature');
  f.git('revert', '--no-edit', '--no-commit', f.strip);
  writeFileSync(f.file, '// legacy note\nconst x = 2;\n');
  f.git('commit', '-am', `Revert "strip comments"\n\nThis reverts commit ${f.strip}.`);
  assert.equal(f.run().status, 1);
});

test('a revert followed by a commit adding a comment still fails', (t) => {
  const f = revertFixture(t);
  f.git('checkout', '-b', 'feature');
  f.git('revert', '--no-edit', f.strip);
  writeFileSync(f.file, '// legacy note\n// fresh\nconst x = 1;\n');
  f.git('commit', '-am', 'add comment');
  assert.equal(f.run().status, 1);
});

test('an uncommitted comment on top of an exact revert still fails', (t) => {
  const f = revertFixture(t);
  f.git('checkout', '-b', 'feature');
  f.git('revert', '--no-edit', f.strip);
  writeFileSync(f.file, '// legacy note\n// fresh\nconst x = 1;\n');
  assert.equal(f.run().status, 1);
});

test('an ordinary change adding a comment still fails', (t) => {
  const f = revertFixture(t);
  f.git('checkout', '-b', 'feature');
  writeFileSync(f.file, '// fresh\nconst x = 1;\n');
  f.git('commit', '-am', 'ordinary');
  assert.equal(f.run().status, 1);
});

test('a revert of a commit that is not on main fails', (t) => {
  const f = revertFixture(t);
  f.git('checkout', '-b', 'side');
  writeFileSync(f.other, 'const y = 1;\n');
  f.git('commit', '-am', 'side strip');
  const side = f.git('rev-parse', 'HEAD');
  f.git('revert', '--no-edit', side);
  assert.equal(f.run(side).status, 1);
});
