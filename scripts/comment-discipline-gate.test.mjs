import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

import { resolve } from 'node:path';
import test from 'node:test';
import { makeTestTempDir } from './test-tmpdir.mjs';

const script = resolve('scripts/comment-discipline-gate.mjs');

test('checks only added source comment lines and exact allowlist entries', () => {
  const cwd = makeTestTempDir('comment-gate-');
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
