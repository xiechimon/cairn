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
// 第四轮补的：删测试的目录与后缀不分大小写（ADR 0021 D4）；另把已有行为钉住：
// 每种可执行扩展名、别票证据的改名原名、嵌套的 biome.json / .gitattributes、
// daemon 的闸源码、e2e/ tests/ __tests__/ 目录。
// 第五轮：CompareFile 的 hasPatch 换成 patchSha（ADR 0021 D3 修订），没有 patch 即
// patchSha 为 null。另钉住：名字里只多一个空格就算保护（SAFE_PATH 放宽到空格时
// 要红）；gateSource 不收普通的保护路径。
// 第六轮（#1420 pr-gate 第四轮）补的：opaque 的证据豁免与摘要同一条，前缀大小写
// 敏感（Docs/Verify/ 在 GitHub 的树里不是证据目录，其中没有 patch 的条目改判
// opaque；别票与可执行两项仍不分大小写，那是严的一侧）；保护 glob 末尾的 /**
// 也认同名的目录项本身（pr-gate.js 第 11 轮的 dirAlone：指向别处的符号链接
// .claude、scripts），可自动合并集不认；不分大小写按 Unicode 折叠（ſ 与 s、
// K 与 k）。另钉住：复制条目的原名也判类，删 .test.mts 与仓根 test/ 下的文件
// 算删测试。

import type { CompareFile } from '@pacman/shared';
import { describe, expect, test } from 'vitest';
import { classifyPaths, globToRegExp } from '../src/services/merge-gate/paths.js';

const f = (filename: string, over: Partial<CompareFile> = {}): CompareFile => ({
  status: 'modified',
  previousFilename: null,
  sha: 'a'.repeat(40),
  additions: 1,
  deletions: 0,
  patchSha: 'c'.repeat(64),
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

  test('dirAlone：末尾的 /** 也认目录项本身，不认同名前缀；不带时不认', () => {
    const dir = globToRegExp('**/scripts/**', { dirAlone: true });
    expect(dir.test('apps/server/src/scripts')).toBe(true);
    expect(dir.test('apps/server/src/scripts/a.sh')).toBe(true);
    expect(dir.test('apps/server/src/scriptsx')).toBe(false);
    expect(globToRegExp('**/scripts/**').test('apps/server/src/scripts')).toBe(false);
    expect(globToRegExp('**/*.config.*', { dirAlone: true }).test('vite.config.ts')).toBe(true);
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
    ['biome.json 嵌套在源码里', 'apps/web/src/biome.json', 'apps/web/src/biome.json.ts'],
    ['tsconfig', 'apps/server/tsconfig.base.json', 'apps/server/src/tsconfig.ts'],
    ['gitignore', 'apps/server/src/.gitignore', 'apps/server/src/gitignore.ts'],
    ['gitattributes 嵌套', 'apps/web/src/.gitattributes', 'apps/web/src/gitattributes.ts'],
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
    ['daemon 的合并决定', 'apps/daemon/src/merge-decision.ts', 'apps/daemon/src/merge.ts'],
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

  test('只多一个空格就算保护：集内源码路径本身不命中任何保护 glob', () => {
    expect(classify([f('apps/server/src/ab.ts')]).protected).toEqual([]);
    const r = classify([f('apps/server/src/a b.ts', { status: 'added' })]);
    expect(r.protected).toEqual(['apps/server/src/a b.ts']);
    expect(r.outsideAutoMerge).toEqual([]);
  });

  test('不分大小写按 Unicode 折叠：ſ（U+017F）同 s、K（U+212A）同 k', () => {
    for (const p of [
      'apps/web/src/AGENTſ.md',
      'packages/x/src/pacKage.json',
      'apps/server/src/ſcripts/x.sh',
    ]) {
      const r = classify([f(p, { status: 'added' })]);
      expect(r.protected, p).toEqual([p]);
      expect(r.outsideAutoMerge, p).toEqual([]);
    }
  });

  test('保护 glob 末尾的 /** 也认同名的目录项本身（指向别处的符号链接，与 pr-gate.js 的 dirAlone 一致）', () => {
    for (const p of [
      'apps/web/src/.claude',
      'apps/server/src/scripts',
      'apps/web/src/drizzle',
      'apps/web/src/.Husky',
      '.github',
      'docs/adr',
    ]) {
      const r = classify([f(p, { status: 'added' })]);
      expect(r.protected, p).toEqual([p]);
      expect(r.outsideAutoMerge, p).toEqual([]);
    }
    const gate = classify([f('apps/server/src/services/merge-gate', { status: 'added' })]);
    expect(gate.protected).toEqual(['apps/server/src/services/merge-gate']);
    expect(gate.gateSource).toEqual(['apps/server/src/services/merge-gate']);
    for (const p of ['apps/web/src/.claudex', 'apps/server/src/scripts.ts', 'apps/web/src/adr']) {
      expect(classify([f(p)]).protected, p).toEqual([]);
    }
  });

  test('复制条目的原名也判类：从保护文件复制出来算命中', () => {
    const r = classify([
      f('apps/web/src/ci.yml', { status: 'copied', previousFilename: '.github/workflows/ci.yml' }),
    ]);
    expect(r.protected).toEqual(['.github/workflows/ci.yml']);
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
    expect(classify([f('apps/daemon/src/merge-decision.ts')]).gateSource).toEqual([
      'apps/daemon/src/merge-decision.ts',
    ]);
  });

  test('普通的保护路径不进 gateSource', () => {
    const r = classify([
      f('.github/workflows/ci.yml'),
      f('apps/server/scripts/db-check.mjs'),
      f('packages/shared/package.json'),
    ]);
    expect(r.protected).toEqual([
      '.github/workflows/ci.yml',
      'apps/server/scripts/db-check.mjs',
      'packages/shared/package.json',
    ]);
    expect(r.gateSource).toEqual([]);
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

  test('可自动合并集的 glob 不认目录项本身：docs/verify、apps/web/src 单独出现算集外', () => {
    for (const p of ['docs/verify', 'apps/web/src', 'apps/server/test', 'integration/test']) {
      const r = classify([f(p, { status: 'added' })]);
      expect(r.protected, p).toEqual([]);
      expect(r.outsideAutoMerge, p).toEqual([p]);
    }
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

  test('e2e/、tests/、__tests__/ 目录下删掉的文件都算，不必带 .test 后缀', () => {
    const removed = [
      'apps/web/e2e/fixtures/board-helpers.ts',
      'apps/server/tests/helpers.ts',
      'packages/shared/src/__tests__/util.ts',
    ];
    const r = classify(removed.map((p) => f(p, { status: 'removed' })));
    expect(r.deletedTests).toEqual(removed);
  });

  test('.test.mts / .spec.cts 与仓根 test/、e2e/ 目录下删掉的文件都算', () => {
    const removed = [
      'apps/server/src/x.test.mts',
      'packages/shared/src/y.spec.cts',
      'test/helpers.ts',
      'e2e/a.ts',
    ];
    const r = classify(removed.map((p) => f(p, { status: 'removed' })));
    expect(r.deletedTests).toEqual(removed);
  });

  test('测试目录与 .test / .spec 后缀不分大小写（ADR 0021 D4，与 pr-gate 的 /i 一致）', () => {
    const r = classify([
      f('apps/server/Tests/helpers.ts', { status: 'removed' }),
      f('apps/web/src/Foo.Test.tsx', { status: 'removed' }),
      f('apps/web/E2E/a.ts', { status: 'removed' }),
      f('apps/web/src/bar.ts', { status: 'renamed', previousFilename: 'apps/web/src/Bar.SPEC.ts' }),
    ]);
    expect(r.deletedTests).toEqual([
      'apps/server/Tests/helpers.ts',
      'apps/web/src/Foo.Test.tsx',
      'apps/web/E2E/a.ts',
      'apps/web/src/Bar.SPEC.ts',
    ]);
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

  // 清单在这里照抄一份，不从 @pacman/shared 引：从词表里删掉一项时这条要红。
  const EXECUTABLE = ['.mjs', '.cjs', '.js', '.mts', '.cts', '.ts', '.jsx', '.tsx', '.sh', '.py'];
  test('每种可执行扩展名：新增、改动、在证据目录里改名成它，都列出', () => {
    for (const ext of EXECUTABLE) {
      const files = [
        f(`docs/verify/1404/new${ext}`, { status: 'added' }),
        f(`docs/verify/1404/edit${ext}`),
        f(`docs/verify/1404/notes${ext}`, {
          status: 'renamed',
          previousFilename: 'docs/verify/1404/notes.txt',
        }),
      ];
      expect(classify(files).executableEvidence, ext).toEqual(files.map((x) => x.filename));
    }
  });

  test('改名把别票的证据移进本票目录：按原名列出', () => {
    const r = classify([
      f('docs/verify/1404/x.json', {
        status: 'renamed',
        previousFilename: 'docs/verify/926/convergence-evidence.json',
      }),
    ]);
    expect(r.otherTicketEvidence).toEqual(['docs/verify/926/convergence-evidence.json']);
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
  // 第六轮翻转：Docs/Verify/1404/b.png 原先按证据豁免，现在列进 opaque（与摘要的
  // isEvidencePath 同一条；#1421 S2 要的）。
  test('证据目录之外的列进 opaque，含删除；证据目录里的不算，前缀大小写敏感（与摘要同一条）', () => {
    const r = classify([
      f('apps/web/public/logo.png', { status: 'added', additions: 0, patchSha: null }),
      f('apps/server/src/big.ts', { additions: 4000, patchSha: null }),
      f('apps/web/public/old.png', { status: 'removed', additions: 0, patchSha: null }),
      f('docs/verify/1404/a.png', { status: 'added', additions: 0, patchSha: null }),
      f('Docs/Verify/1404/b.png', { status: 'added', additions: 0, patchSha: null }),
      f('apps/server/src/a.ts'),
    ]);
    expect(r.opaque).toEqual([
      'apps/web/public/logo.png',
      'apps/server/src/big.ts',
      'apps/web/public/old.png',
      'Docs/Verify/1404/b.png',
    ]);
  });

  test('改名没有 patch：两头里落在证据目录之外的名字都列出', () => {
    const r = classify([
      f('apps/server/src/new.ts', {
        status: 'renamed',
        previousFilename: 'apps/server/src/old.ts',
        additions: 0,
        patchSha: null,
      }),
      f('docs/verify/1404/moved.png', {
        status: 'renamed',
        previousFilename: 'apps/web/public/moved.png',
        additions: 0,
        patchSha: null,
      }),
      f('docs/verify/1404/c.png', {
        status: 'renamed',
        previousFilename: 'docs/verify/1404/b.png',
        additions: 0,
        patchSha: null,
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
