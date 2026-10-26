import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileViolations, textViolations } from './english-only-gate.mjs';
import { makeTestTempDir } from './test-tmpdir.mjs';

const script = resolve('scripts/english-only-gate.mjs');

test('prose flags Chinese outside code spans, fences and HTML comments', () => {
  const doc = [
    '## 图片素材',
    'Click the `开始` button.',
    '```',
    '暂无成员',
    '```',
    '<!-- 注释 -->',
    'Plain English.',
    'Mixed，punctuation',
  ].join('\n');
  assert.deepEqual(fileViolations('docs/a.md', doc), [1, 8]);
  assert.deepEqual(textViolations('## What 什么\n\nAll English.'), [1]);
  assert.deepEqual(textViolations('~~~\n```\n中文\n~~~\n中文'), [5]);
});

test('code checks comments only; UI strings and exempt paths pass', () => {
  const code = [
    "await expect(page.getByRole('button', { name: '显示完整文件' })).toBeVisible();",
    "name: body.name ?? 'machine', // --name \u9ed8\u8ba4 hostname",
    '/* block start',
    ' * 续行',
    ' */',
    "const url = 'https://example.com'; // fine",
    "const label = 'a // \u4e2d label';",
    '// Safari private mode throws on setItem',
  ].join('\n');
  assert.deepEqual(fileViolations('apps/server/src/x.ts', code), [2, 4]);
  assert.deepEqual(fileViolations('scripts/x.py', "x = '中'\n# 中文\n#!/bin/中"), [2]);
  assert.deepEqual(fileViolations('README.zh.md', '中文'), []);
  assert.deepEqual(fileViolations('apps/web/src/i18n/en.ts', '// 中文'), []);
  assert.deepEqual(fileViolations('assets/logo.svg', '中文'), []);
});

test('diff mode reds added Chinese lines and Chinese commit messages only', () => {
  const cwd = makeTestTempDir('english-gate-');
  const git = (...args) =>
    execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=T', ...args], {
      cwd,
      stdio: 'pipe',
    });
  const run = (env = {}) =>
    spawnSync(process.execPath, [script], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, ENGLISH_ONLY_BASE_SHA: '', PREPUSH_BASE_SHA: '', ...env },
    });
  try {
    git('init');
    mkdirSync(join(cwd, 'docs'));
    writeFileSync(join(cwd, 'docs/prompts.md'), '# 旧标题\n\nold\n');
    git('add', 'docs/prompts.md');
    git('commit', '-m', 'baseline');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    assert.equal(run().status, 0);

    writeFileSync(join(cwd, 'docs/prompts.md'), '# 旧标题\n\nnew English line\n');
    git('commit', '-am', 'docs: english edit');
    assert.equal(run().status, 0, run().stderr);

    writeFileSync(
      join(cwd, 'docs/prompts.md'),
      '# 旧标题\n\nnew English line\n\n## 图片素材\n\n站点、README 这类图片，先用 codex 生图。\n',
    );
    const dirty = run();
    assert.equal(dirty.status, 1);
    assert.match(dirty.stderr, /docs\/prompts.md:5:/);
    assert.match(dirty.stderr, /docs\/prompts.md:7:/);
    assert.doesNotMatch(dirty.stderr, /docs\/prompts.md:1:/);

    writeFileSync(join(cwd, 'docs/prompts.md'), '# 旧标题\n\nnew English line\n');
    git('commit', '--allow-empty', '-m', 'docs(spec-18): 形态原则——一个总管，代码必过闸 (#1627)');
    const commit = run();
    assert.equal(commit.status, 1);
    assert.match(commit.stderr, /^commit [0-9a-f]{10}:1:/m);

    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    assert.equal(run().status, 0);
    assert.equal(run({ ENGLISH_ONLY_BASE_SHA: 'missing-ref' }).status, 2);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('--text checks a PR body file', () => {
  const cwd = makeTestTempDir('english-gate-text-');
  try {
    writeFileSync(join(cwd, 'body.md'), '## What\n\nAdds an「图片素材」section.\n');
    const red = spawnSync(process.execPath, [script, '--text', join(cwd, 'body.md')], {
      encoding: 'utf8',
    });
    assert.equal(red.status, 1);
    writeFileSync(join(cwd, 'body.md'), '## What\n\nAdds an image-assets section (`图片素材`).\n');
    const green = spawnSync(process.execPath, [script, '--text', join(cwd, 'body.md')], {
      encoding: 'utf8',
    });
    assert.equal(green.status, 0, green.stderr);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
