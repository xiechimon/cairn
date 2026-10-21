// 合并就绪闸 S1（#1404）：ADR 0021 D4 路径判定。
// 与 .claude/workflows/pr-gate.js 同一套口径：默认拒绝（只有产品源码、测试与
// docs/verify 可不经人），其中再排除保护类别；按类、任意层级、不分大小写。
// 失败方式先行：改名把保护文件移出保护路径、大小写变体、嵌套的 scripts/ 与
// 配置、靠改名删测试、往别的票的证据目录写、证据目录里夹带可执行文件。
// pr-gate 第一轮（#1420）补的：名字里带换行或空格时 `.` 跨不过去，保护 glob
// 落空而集内 glob 命中；测试在测试目录里改名成不被收集的名字；证据目录前缀
// 换大小写绕开别票 / 可执行检查；票号是另一票号的前缀。
// 第三轮（ADR 0021 D4 修订）补的：证据目录之外的二进制文件留人。compare 对
// 二进制不给 patch，纯改名也不给，分不出来，一并留人（严的一侧）。

import type { CompareFile } from '@pacman/shared';
import { describe, expect, test } from 'vitest';
import { classifyPaths, globToRegExp } from '../src/services/merge-gate/paths.js';

const f = (filename: string, over: Partial<CompareFile> = {}): CompareFile => ({
  status: 'modified',
  previousFilename: null,
  sha: 'a'.repeat(40),
  additions: 1,
  deletions: 0,
  hasPatch: true,
  ...over,
  filename,
});

const classify = (files: CompareFile[], ticketRef = '1404') => classifyPaths(files, ticketRef);

describe('globToRegExp', () => {
  test('**/ 含仓根，* 不跨目录，不分大小写', () => {
    expect(globToRegExp('**/scripts/**').test('scripts/a.mjs')).toBe(true);
    expect(globToRegExp('**/scripts/**').test('apps/server/scripts/db-check.mjs')).toBe(true);
    expect(globToRegExp('apps/*/src/**').test('apps/server/src/a/b.ts')).toBe(true);
    expect(globToRegExp('apps/*/src/**').test('apps/server/x/src/a.ts')).toBe(false);
    expect(globToRegExp('**/CLAUDE*.md').test('apps/web/Claude.md')).toBe(true);
  });
});

describe('保护类别：任意层级、不分大小写，各一真一假', () => {
  const cases: [string, string, string][] = [
    // [类别, 命中, 不命中]
    ['CI', '.github/workflows/ci.yml', 'apps/web/src/github.ts'],
    ['钩子', 'apps/x/.husky/pre-commit', 'apps/web/src/husky.ts'],
    ['agent 设置', 'apps/web/.claude/skills/x/SKILL.md', 'apps/web/src/claude.ts'],
    ['pi 技能', '.pi/skills/x/SKILL.md', 'apps/web/src/pi.ts'],
    ['cursor', '.cursor/skills/verify-pacman/SKILL.md', 'apps/web/src/cursor.ts'],
    ['MCP 配置', '.mcp.json', 'apps/web/src/mcp.json.ts'],
    ['scout 放行表', '.ckignore', 'apps/web/src/ckignore.ts'],
    ['CLAUDE 变体', 'CLAUDE.local.md', 'apps/web/src/claude-md.ts'],
    ['AGENTS 变体', 'AGENTS.override.md', 'apps/web/src/agents.ts'],
    ['评审口径', 'docs/pr-review.md', 'docs/pr-review-notes/x.md'],
    ['ADR', 'docs/adr/0021-x.md', 'docs/adrs.md'],
    ['闸脚本', 'apps/server/scripts/db-check.mjs', 'apps/server/src/scriptsx.ts'],
    ['配置', 'apps/web/vite.config.mts', 'apps/web/src/config.ts'],
    ['biome', 'apps/web/biome.jsonc', 'apps/web/src/biome.ts'],
    ['tsconfig', 'apps/server/tsconfig.base.json', 'apps/server/src/tsconfig.ts'],
    ['gitignore', 'apps/server/src/.gitignore', 'apps/server/src/gitignore.ts'],
    ['迁移', 'apps/server/drizzle/0044_x.sql', 'apps/server/src/drizzle.ts'],
    ['依赖清单', 'packages/shared/package.json', 'packages/shared/src/package.ts'],
    ['锁文件', 'pnpm-lock.yaml', 'apps/web/src/lock.ts'],
    ['工作区', 'pnpm-workspace.yaml', 'apps/web/src/workspace.ts'],
    ['npmrc', 'apps/web/.npmrc', 'apps/web/src/npmrc.ts'],
    [
      '闸源码',
      'apps/server/src/services/merge-gate/digest.ts',
      'apps/server/src/services/builds.ts',
    ],
    [
      '闸词表',
      'packages/shared/src/records/merge-gate.ts',
      'packages/shared/src/records/review.ts',
    ],
  ];
  for (const [label, hit, miss] of cases) {
    test(label, () => {
      expect(classify([f(hit)]).protected).toEqual([hit]);
      expect(classify([f(miss)]).protected).toEqual([]);
    });
  }

  test('大小写变体照样命中', () => {
    for (const p of [
      '.Claude/settings.json',
      '.Husky/pre-commit',
      'apps/web/src/Claude.md',
      'AGENTS.MD',
      'Scripts/x.mjs',
    ]) {
      expect(classify([f(p)]).protected, p).toEqual([p]);
    }
  });

  test('名字里有换行、回车、空格或其它白名单外字符：一律算保护（与 pr-gate SAFE_PATH 同一白名单）', () => {
    for (const p of [
      'apps/x\ny/src/CLAUDE.md',
      'apps/x\ny/src/.claude/skills/foo/SKILL.md',
      'apps/x\ry/src/package.json',
      'apps/x y/src/AGENTS.md',
      'apps/server/src/a\u2028b.ts',
    ]) {
      const r = classify([f(p, { status: 'added' })]);
      expect(r.protected, JSON.stringify(p)).toEqual([p]);
      expect(r.outsideAutoMerge, JSON.stringify(p)).toEqual([]);
    }
  });

  test('改名把保护文件移走：按原路径命中', () => {
    const r = classify([
      f('apps/web/src/moved.yml', {
        status: 'renamed',
        previousFilename: '.github/workflows/ci.yml',
      }),
    ]);
    expect(r.protected).toEqual(['.github/workflows/ci.yml']);
  });

  test('闸源码另列一份（D4 ④）', () => {
    expect(classify([f('apps/server/src/services/merge-gate/readiness.ts')]).gateSource).toEqual([
      'apps/server/src/services/merge-gate/readiness.ts',
    ]);
  });
});

describe('默认拒绝：可自动合并集之外一律留人', () => {
  test('产品源码、测试、e2e 与本票证据在集内', () => {
    const files = [
      'apps/server/src/services/ci-loop.ts',
      'apps/server/test/ci-loop.test.ts',
      'apps/web/e2e/board.spec.ts',
      'packages/shared/src/records/review.ts',
      'packages/shared/test/x.test.ts',
      'integration/test/m5.test.ts',
      'docs/verify/1404/run.txt',
    ].map((p) => f(p));
    const r = classify(files);
    expect(r.outsideAutoMerge).toEqual([]);
    expect(r.protected).toEqual([]);
  });

  test('集外路径（文档、根文件、public、eval）各自列出', () => {
    const files = [
      'docs/spec/28-x.md',
      'README.md',
      'CONTEXT.md',
      'apps/web/public/x.svg',
      'integration/eval/x.ts',
    ];
    expect(classify(files.map((p) => f(p))).outsideAutoMerge).toEqual(files);
  });

  test('保护路径不重复记进集外', () => {
    const r = classify([f('.github/workflows/ci.yml')]);
    expect(r.outsideAutoMerge).toEqual([]);
  });

  test('改名从集外移进集内：按原路径记集外', () => {
    const r = classify([
      f('apps/web/src/x.ts', { status: 'renamed', previousFilename: 'docs/spec/x.md' }),
    ]);
    expect(r.outsideAutoMerge).toEqual(['docs/spec/x.md']);
  });
});

describe('删测试', () => {
  test('删除测试目录下的文件，或删除 .test / .spec 文件', () => {
    const r = classify([
      f('integration/test/helpers.ts', { status: 'removed' }),
      f('apps/web/src/x.test.tsx', { status: 'removed' }),
      f('apps/web/src/x.ts', { status: 'removed' }),
    ]);
    expect(r.deletedTests).toEqual(['integration/test/helpers.ts', 'apps/web/src/x.test.tsx']);
  });

  test('把测试改名成非测试路径也算删测试', () => {
    const r = classify([
      f('apps/server/src/foo.ts', {
        status: 'renamed',
        previousFilename: 'apps/server/test/foo.test.ts',
      }),
    ]);
    expect(r.deletedTests).toEqual(['apps/server/test/foo.test.ts']);
  });

  test('改测试、加测试都不算', () => {
    const r = classify([
      f('apps/server/test/a.test.ts'),
      f('apps/server/test/b.test.ts', { status: 'added' }),
    ]);
    expect(r.deletedTests).toEqual([]);
  });

  test('测试的任何改名都算删了原测试（与 pr-gate 的 --no-renames 一致），含测试目录里改成不被收集的名字', () => {
    const r = classify([
      f('apps/server/test/foo.ts', {
        status: 'renamed',
        previousFilename: 'apps/server/test/foo.test.ts',
      }),
      f('apps/web/e2e/board.spec.ts.skip', {
        status: 'renamed',
        previousFilename: 'apps/web/e2e/board.spec.ts',
      }),
      f('apps/server/test/c.test.ts', {
        status: 'renamed',
        previousFilename: 'apps/server/test/d.test.ts',
      }),
    ]);
    expect(r.deletedTests).toEqual([
      'apps/server/test/foo.test.ts',
      'apps/web/e2e/board.spec.ts',
      'apps/server/test/d.test.ts',
    ]);
  });
});

describe('证据目录', () => {
  test('写本票目录可以，写别的票的目录列出（含删除）', () => {
    const r = classify([
      f('docs/verify/1404/a.png', { status: 'added' }),
      f('docs/verify/926/convergence-evidence.json'),
      f('docs/verify/1050/result.json', { status: 'removed' }),
    ]);
    expect(r.otherTicketEvidence).toEqual([
      'docs/verify/926/convergence-evidence.json',
      'docs/verify/1050/result.json',
    ]);
  });

  test('本 PR 新增或改动的可执行证据列出，删除的不算', () => {
    const r = classify([
      f('docs/verify/1404/probe.mjs', { status: 'added' }),
      f('docs/verify/1404/run.SH'),
      f('docs/verify/1404/old.py', { status: 'removed' }),
      f('docs/verify/1404/data.json', { status: 'added' }),
    ]);
    expect(r.executableEvidence).toEqual(['docs/verify/1404/probe.mjs', 'docs/verify/1404/run.SH']);
  });

  test('证据目录前缀换大小写也照样检查别票与可执行文件；.tsx / .jsx 算可执行', () => {
    const r = classify([
      f('Docs/Verify/926/x.json'),
      f('DOCS/verify/1404/probe.MJS', { status: 'added' }),
      f('docs/verify/1404/view.tsx', { status: 'added' }),
      f('docs/verify/1404/view.jsx', { status: 'added' }),
    ]);
    expect(r.otherTicketEvidence).toEqual(['Docs/Verify/926/x.json']);
    expect(r.executableEvidence).toEqual([
      'DOCS/verify/1404/probe.MJS',
      'docs/verify/1404/view.tsx',
      'docs/verify/1404/view.jsx',
    ]);
  });

  test('票号是另一票号的前缀：14040 不是 1404 的目录', () => {
    const r = classify([f('docs/verify/14040/a.txt', { status: 'added' })]);
    expect(r.otherTicketEvidence).toEqual(['docs/verify/14040/a.txt']);
  });

  test('票号段大小写敏感匹配之外不做猜测：XMON-104 与 xmon-104 是两个目录', () => {
    const r = classify([f('docs/verify/xmon-104/a.txt', { status: 'added' })], 'XMON-104');
    expect(r.otherTicketEvidence).toEqual(['docs/verify/xmon-104/a.txt']);
  });
});

describe('compare 不给 patch 的条目（二进制、diff 过大、纯改名）', () => {
  test('证据目录之外的列进 opaque，含删除；证据目录里的不算，前缀不分大小写', () => {
    const r = classify([
      f('apps/web/public/logo.png', { status: 'added', additions: 0, hasPatch: false }),
      f('apps/server/src/big.ts', { additions: 4000, hasPatch: false }),
      f('apps/web/public/old.png', { status: 'removed', additions: 0, hasPatch: false }),
      f('docs/verify/1404/a.png', { status: 'added', additions: 0, hasPatch: false }),
      f('Docs/Verify/1404/b.png', { status: 'added', additions: 0, hasPatch: false }),
      f('apps/server/src/a.ts'),
    ]);
    expect(r.opaque).toEqual([
      'apps/web/public/logo.png',
      'apps/server/src/big.ts',
      'apps/web/public/old.png',
    ]);
  });

  test('改名没有 patch：两头里落在证据目录之外的名字都列出', () => {
    const r = classify([
      f('apps/server/src/new.ts', {
        status: 'renamed',
        previousFilename: 'apps/server/src/old.ts',
        additions: 0,
        hasPatch: false,
      }),
      f('docs/verify/1404/moved.png', {
        status: 'renamed',
        previousFilename: 'apps/web/public/moved.png',
        additions: 0,
        hasPatch: false,
      }),
      f('docs/verify/1404/c.png', {
        status: 'renamed',
        previousFilename: 'docs/verify/1404/b.png',
        additions: 0,
        hasPatch: false,
      }),
      f('apps/server/src/r.ts', { status: 'renamed', previousFilename: 'apps/server/src/q.ts' }),
    ]);
    expect(r.opaque).toEqual([
      'apps/server/src/new.ts',
      'apps/server/src/old.ts',
      'apps/web/public/moved.png',
    ]);
  });
});
