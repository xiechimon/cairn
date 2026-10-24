// 合并就绪闸 S1（#1404）：ADR 0021 D4 路径判定。
// 与 .claude/workflows/pr-gate.js 同一套口径：默认拒绝（只有产品源码、测试与
// docs/verify 可不经人），其中再排除保护类别；按类、任意层级。大小写折叠按方向分
// （与 pr-gate.js 一致）：放行的一侧（可自动合并集）只折 ASCII，ſrc 不算 src、落在
// 集外；收紧的一侧（保护类别、闸源码、测试目录与后缀、判别票与可执行用的证据前缀与
// 扩展名）按 Unicode 折叠（ſ 与 s、K 与 k）。globToRegExp 的 protect 同时带 iu 与
// 末尾 /** 的目录项本身。没有 patch 的条目 patchSha 为 null。
// 失败方式先行：
// - 保护：改名把保护文件移出保护路径（复制条目的原名也判类）、大小写变体、嵌套的
//   scripts/ 与配置（biome.json、.gitattributes）、daemon 的闸源码；名字里带换行或
//   空格时 `.` 跨不过去，保护 glob 落空而集内 glob 命中（名字里只多一个空格也算保护）；
//   保护 glob 末尾的 /** 不认同名的目录项本身（指向别处的符号链接 .claude、scripts），
//   可自动合并集却认了；gateSource 收了普通的保护路径；保护类别 ⑤（AGENTS.md 要
//   /security-review 的文件与跑迁移的 DB 引导）漏判，它是锚定的原路径清单，与
//   pr-gate.js 的 PROTECTED 同一份。
// - 删测试：靠改名删测试（在测试目录里改名成不被收集的名字）；删测试的目录与后缀分
//   大小写；漏掉 e2e/ tests/ __tests__/ 目录、.test.mts 与仓根 test/ 下的文件。
// - 证据目录：往别的票的证据目录写（含改名的原名）；证据目录前缀换大小写绕开别票 /
//   可执行检查；票号是另一票号的前缀；证据目录里夹带可执行文件（每种可执行扩展名，含
//   shell、PowerShell、Windows 批处理与 HTML 四族）。
// - 看不到 diff 的条目：证据目录之外的二进制、diff 过大与纯改名（compare 都不给
//   patch，分不出来，一并留人，严的一侧）被放过。opaque 的证据豁免与摘要同一条
//   （isEvidencePath），前缀大小写敏感：Docs/Verify/ 在 GitHub 的树里不是证据目录，
//   其中没有 patch 的条目列进 opaque。
// - 漂移：仓里 .claude/workflows/pr-gate.js 的 AUTO_MERGE 与 PROTECTED 两个数组须与
//   词表逐项同序（PROTECTED 对 PROTECTED_PATH_GLOBS 加 MERGE_GATE_SOURCE_GLOBS），两份
//   清单漂移即红。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AUTO_MERGE_PATH_GLOBS,
  type CompareFile,
  MERGE_GATE_SOURCE_GLOBS,
  PROTECTED_PATH_GLOBS,
} from '@cairn/shared';
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

  test('protect：末尾的 /** 也认目录项本身，不认同名前缀；不带时不认', () => {
    const dir = globToRegExp('**/scripts/**', { protect: true });
    expect(dir.test('apps/server/src/scripts')).toBe(true);
    expect(dir.test('apps/server/src/scripts/a.sh')).toBe(true);
    expect(dir.test('apps/server/src/scriptsx')).toBe(false);
    expect(globToRegExp('**/scripts/**').test('apps/server/src/scripts')).toBe(false);
    expect(globToRegExp('**/*.config.*', { protect: true }).test('vite.config.ts')).toBe(true);
  });

  test('protect 按 Unicode 折叠，不带时只折 ASCII', () => {
    expect(globToRegExp('**/scripts/**', { protect: true }).test('\u{17F}cripts/a.sh')).toBe(true);
    expect(globToRegExp('**/scripts/**').test('\u{17F}cripts/a.sh')).toBe(false);
    expect(globToRegExp('**/scripts/**').test('SCRIPTS/a.sh')).toBe(true);
  });
});

describe('保护类别：任意层级、不分大小写，各一真一假', () => {
  const cases: [string, string, string][] = [
    // [类别, 命中, 不命中]
    ['CI', '.github/workflows/ci.yml', 'apps/web/src/github.ts'],
    ['钩子', 'apps/x/.husky/pre-commit', 'apps/web/src/husky.ts'],
    ['agent 设置', 'apps/web/.claude/skills/x/SKILL.md', 'apps/web/src/claude.ts'],
    ['pi 技能', '.pi/skills/x/SKILL.md', 'apps/web/src/pi.ts'],
    ['cursor', '.cursor/skills/verify-cairn/SKILL.md', 'apps/web/src/cursor.ts'],
    ['MCP 配置', '.mcp.json', 'apps/web/src/mcp.json.ts'],
    ['scout 放行表', '.ckignore', 'apps/web/src/ckignore.ts'],
    ['CLAUDE 变体', 'CLAUDE.local.md', 'apps/web/src/claude-md.ts'],
    ['AGENTS 变体', 'AGENTS.override.md', 'apps/web/src/agents.ts'],
    ['评审口径', 'docs/pr-review.md', 'docs/pr-review-notes/x.md'],
    ['错误台账', 'docs/lessons.md', 'docs/lessons-archive.md'],
    ['错误台账条目', 'docs/lessons/1651-probe-reach.md', 'docs/lessonsx/1651.md'],
    ['派活模板', 'docs/agent-dispatch-prompts.md', 'docs/agent-dispatch.md'],
    ['ADR', 'docs/adr/0021-x.md', 'docs/adrs.md'],
    ['设计决定', 'docs/spec/28-x.md', 'docs/specs.md'],
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
      'apps/web/src/AGENT\u{17F}.md',
      'packages/x/src/pac\u{212A}age.json',
      'apps/server/src/\u{17F}cripts/x.sh',
    ]) {
      const r = classify([f(p, { status: 'added' })]);
      expect(r.protected, p).toEqual([p]);
      expect(r.outsideAutoMerge, p).toEqual([]);
    }
  });

  test('保护 glob 末尾的 /** 也认同名的目录项本身（指向别处的符号链接，与 pr-gate.js 的 protect 一致）', () => {
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

  // 清单在这里照抄一份（ADR 0021 D4 ⑤，#1410 第 12 轮），不从 @cairn/shared 引：从词表里
  // 删掉一项时这条要红。machine*.ts 是 glob，下一条另测。
  const SECURITY_SURFACES = [
    'apps/server/src/lib/secret-box.ts',
    'apps/server/src/lib/keys.ts',
    'apps/server/src/lib/token-auth.ts',
    'apps/server/src/lib/attachments-token.ts',
    'apps/server/src/services/secrets.ts',
    'apps/server/src/services/credentials.ts',
    'apps/server/src/services/api-keys.ts',
    'apps/server/src/services/webhook-tokens.ts',
    'apps/server/src/services/oauth.ts',
    'apps/server/src/routes-machine.ts',
    'apps/daemon/src/credentials.ts',
    'apps/daemon/src/secret-channel.ts',
    'apps/daemon/src/shell-channel.ts',
    'apps/daemon/src/machine-client.ts',
    'apps/daemon/src/backend/command-gate.ts',
    'apps/server/src/services/mcp-face.ts',
    'apps/server/src/services/mcp-servers.ts',
    'apps/server/src/routes-webhook.ts',
    'apps/server/src/db/client.ts',
  ];
  test('⑤ 安全敏感面与跑迁移的 DB 引导：清单里每个文件都算保护，不进 gateSource', () => {
    for (const p of SECURITY_SURFACES) {
      const r = classify([f(p)]);
      expect(r.protected, p).toEqual([p]);
      expect(r.gateSource, p).toEqual([]);
      expect(r.outsideAutoMerge, p).toEqual([]);
    }
  });

  test('⑤ 与其它保护 glob 同样不分大小写', () => {
    for (const p of ['Apps/Server/src/lib/Secret-Box.ts', 'apps/server/src/DB/Client.ts']) {
      expect(classify([f(p)]).protected, p).toEqual([p]);
    }
  });

  test('⑤ 的 machine*.ts：machines.ts、machine-relay.ts 命中；* 不跨目录，machine/x.ts 不命中', () => {
    for (const p of [
      'apps/server/src/services/machines.ts',
      'apps/server/src/services/machine-relay.ts',
    ]) {
      expect(classify([f(p)]).protected, p).toEqual([p]);
    }
    const r = classify([f('apps/server/src/services/machine/x.ts')]);
    expect(r.protected).toEqual([]);
    expect(r.outsideAutoMerge).toEqual([]);
  });

  test('⑤ 锚定在原路径：近邻与别处的同名文件仍可自动合并', () => {
    for (const p of [
      'apps/server/src/services/todos.ts',
      'apps/web/src/db/client.ts',
      'apps/web/src/lib/keys.ts',
      'apps/server/src/services/oauth-callback.ts',
    ]) {
      const r = classify([f(p)]);
      expect(r.protected, p).toEqual([]);
      expect(r.outsideAutoMerge, p).toEqual([]);
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

  test('集外路径（docs 下的非 Markdown、根文件、public、eval）各自列出', () => {
    const files = [
      'docs/research/assets/r1/sw.js',
      'docs/research/assets/r1/asset-manifest.json',
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

  test('可自动合并集只折 ASCII 大小写：只靠 Unicode 折叠才像集内的名字（\u{17F}rc、pac\u{212A}ages）落在集外', () => {
    for (const p of ['apps/web/\u{17F}rc/x.ts', 'pac\u{212A}ages/x/src/a.ts']) {
      const r = classify([f(p, { status: 'added' })]);
      expect(r.protected, p).toEqual([]);
      expect(r.outsideAutoMerge, p).toEqual([p]);
    }
    expect(classify([f('Apps/Web/SRC/x.ts')]).outsideAutoMerge).toEqual([]);
  });

  test('保护路径不重复记进集外', () => {
    const r = classify([f('.github/workflows/ci.yml')]);
    expect(r.outsideAutoMerge).toEqual([]);
  });

  test('改名从集外移进集内：按原路径记集外', () => {
    const r = classify([
      f('apps/web/src/x.ts', { status: 'renamed', previousFilename: 'README.md' }),
    ]);
    expect(r.outsideAutoMerge).toEqual(['README.md']);
  });
});

describe('纯文档（#1621）：docs 下的 Markdown 在集内，设计决定、ADR 与评审口径仍留人', () => {
  test('docs 下任意层级的 Markdown 在集内', () => {
    const files = ['docs/ops/langfuse.md', 'docs/README.md', 'docs/a3/x.md', 'docs/research/r1.MD'];
    const r = classify(files.map((p) => f(p)));
    expect(r.protected).toEqual([]);
    expect(r.outsideAutoMerge).toEqual([]);
  });

  test('保护的文档路径换大小写或 Unicode 折叠照样命中，不落进集内', () => {
    for (const p of [
      'docs/ADR/0021-x.md',
      'Docs/Adr/0021-x.md',
      'docs/SPEC/28-x.md',
      'docs/\u{17F}pec/28-x.md',
      'docs/PR-Review.md',
      'doc\u{17F}/pr-review.md',
      'doc\u{17F}/adr/0021-x.md',
      'docs/spec',
    ]) {
      const asciiFold = p.normalize('NFKC').toLowerCase();
      expect(classify([f(asciiFold)]).protected, `${p} folds to ${asciiFold}`).toEqual([asciiFold]);
      const r = classify([f(p, { status: 'added' })]);
      expect(r.protected, p).toEqual([p]);
      expect(r.outsideAutoMerge, p).toEqual([]);
    }
  });

  test('只靠 Unicode 折叠才像 docs 的名字落在集外', () => {
    const p = 'doc\u{17F}/x.md';
    const r = classify([f(p, { status: 'added' })]);
    expect(r.protected).toEqual([]);
    expect(r.outsideAutoMerge).toEqual([p]);
  });

  test('改名把 ADR 移成普通文档：按原名算保护', () => {
    const r = classify([
      f('docs/notes/0021.md', { status: 'renamed', previousFilename: 'docs/adr/0021-x.md' }),
    ]);
    expect(r.protected).toEqual(['docs/adr/0021-x.md']);
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

  test('测试目录与后缀按 Unicode 折叠（收紧的一侧）：te\u{17F}t/ 是测试目录，.te\u{17F}t.ts 是测试文件', () => {
    const removed = ['apps/server/te\u{17F}t/helpers.ts', 'apps/web/src/x.te\u{17F}t.ts'];
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

  // 清单在这里照抄一份，不从 @cairn/shared 引：从词表里删掉一项时这条要红。
  const EXECUTABLE = [
    '.mjs',
    '.cjs',
    '.js',
    '.mts',
    '.cts',
    '.ts',
    '.jsx',
    '.tsx',
    '.sh',
    '.py',
    '.bash',
    '.zsh',
    '.fish',
    '.ps1',
    '.psm1',
    '.bat',
    '.cmd',
    '.html',
    '.htm',
  ];
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

  test('判别票与可执行用的证据前缀按 Unicode 折叠（收紧的一侧）：doc\u{17F}/verify/1405/x.sh 列进别票与可执行，同时落在可自动合并集外', () => {
    const name = 'doc\u{17F}/verify/1405/x.sh';
    const r = classify([f(name, { status: 'added' })]);
    expect(r.outsideAutoMerge).toEqual([name]);
    expect(r.otherTicketEvidence).toEqual([name]);
    expect(r.executableEvidence).toEqual([name]);
    const own = classify([f('doc\u{17F}/verify/1404/a.txt', { status: 'added' })]);
    expect(own.otherTicketEvidence).toEqual([]);
  });

  test('单独的 docs/verify 条目（顶替证据目录的符号链接）列进别票：票号段为空', () => {
    const r = classify([f('docs/verify', { status: 'added' })]);
    expect(r.otherTicketEvidence).toEqual(['docs/verify']);
    expect(r.outsideAutoMerge).toEqual(['docs/verify']);
  });

  test('可执行扩展名同样按 Unicode 折叠：.\u{17F}h、.j\u{17F} 算可执行', () => {
    const files = ['docs/verify/1404/x.\u{17F}h', 'docs/verify/1404/y.j\u{17F}'];
    expect(classify(files.map((p) => f(p, { status: 'added' }))).executableEvidence).toEqual(files);
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
  // Docs/Verify/1404/b.png 不在证据目录里（前缀大小写敏感，与摘要的 isEvidencePath
  // 同一条），没有 patch 即列进 opaque。
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

describe('可执行扩展名：shell、PowerShell、Windows 批处理与 HTML 四族', () => {
  const families: [string, string[]][] = [
    ['shell', ['.bash', '.zsh', '.fish']],
    ['PowerShell', ['.ps1', '.psm1']],
    ['Windows 批处理', ['.bat', '.cmd']],
    ['HTML（浏览器打开即跑脚本）', ['.html', '.htm']],
  ];
  for (const [family, exts] of families) {
    test(`${family}：${exts.join(' ')} 新增即列出，扩展名换大小写也算`, () => {
      const files = exts.flatMap((ext) => [
        `docs/verify/1404/run${ext}`,
        `docs/verify/1404/RUN${ext.toUpperCase()}`,
      ]);
      const r = classify(files.map((p) => f(p, { status: 'added' })));
      expect(r.executableEvidence).toEqual(files);
    });
  }
});

/** pr-gate.js 里 `const NAME = [` 那一行到其后第一行 `]` 之间的字符串字面量，一行一个；
 * 空行与注释行跳过，别的形状一律报错，找不到数组也报错，免得解析悄悄少读。 */
function prGateArray(source: string, name: string): string[] {
  const lines = source.split('\n');
  const start = lines.indexOf(`const ${name} = [`);
  if (start === -1) throw new Error(`pr-gate.js: \`const ${name} = [\` not found`);
  const end = lines.indexOf(']', start + 1);
  if (end === -1) throw new Error(`pr-gate.js: closing \`]\` of ${name} not found`);
  return lines.slice(start + 1, end).flatMap((raw) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('//')) return [];
    const m = /^'([^'\\]+)',?$/.exec(line);
    if (m?.[1] === undefined) throw new Error(`pr-gate.js: unexpected line in ${name}: ${raw}`);
    return [m[1]];
  });
}

describe('与 .claude/workflows/pr-gate.js 同一份清单', () => {
  const prGate = () =>
    readFileSync(join(import.meta.dirname, '../../../.claude/workflows/pr-gate.js'), 'utf8');

  test('AUTO_MERGE 与 AUTO_MERGE_PATH_GLOBS 逐项同序', () => {
    expect(prGateArray(prGate(), 'AUTO_MERGE')).toEqual([...AUTO_MERGE_PATH_GLOBS]);
  });

  test('PROTECTED 与 PROTECTED_PATH_GLOBS 加 MERGE_GATE_SOURCE_GLOBS 逐项同序', () => {
    expect(prGateArray(prGate(), 'PROTECTED')).toEqual([
      ...PROTECTED_PATH_GLOBS,
      ...MERGE_GATE_SOURCE_GLOBS,
    ]);
  });

  test('解析器找不到数组、找不到收尾的 ]、遇到不认识的行都报错', () => {
    expect(() => prGateArray("const X = [\n  'a/**',\n]", 'AUTO_MERGE')).toThrow(/not found/);
    expect(() => prGateArray("const AUTO_MERGE = [\n  'a/**',\n", 'AUTO_MERGE')).toThrow(/closing/);
    expect(() => prGateArray("const AUTO_MERGE = [\n  'a/**', 'b/**',\n]", 'AUTO_MERGE')).toThrow(
      /unexpected line/,
    );
    expect(prGateArray("const AUTO_MERGE = [\n  // note's\n  'a/**',\n]", 'AUTO_MERGE')).toEqual([
      'a/**',
    ]);
  });
});
