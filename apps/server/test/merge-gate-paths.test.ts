import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AUTO_MERGE_PATH_GLOBS,
  CHIEF_DISPATCH_HARNESS_PATHS,
  type CompareFile,
  MERGE_GATE_SOURCE_GLOBS,
  PROTECTED_PATH_GLOBS,
} from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { classifyPaths, globToRegExp, touchesHarness } from '../src/services/merge-gate/paths.js';

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
  test('**/ covers the repo root, * does not cross directories, case-insensitive', () => {
    expect(globToRegExp('**/scripts/**').test('scripts/a.mjs')).toBe(true);
    expect(globToRegExp('**/scripts/**').test('apps/server/scripts/db-check.mjs')).toBe(true);
    expect(globToRegExp('apps/*/src/**').test('apps/server/src/a/b.ts')).toBe(true);
    expect(globToRegExp('apps/*/src/**').test('apps/server/x/src/a.ts')).toBe(false);
    expect(globToRegExp('**/CLAUDE*.md').test('apps/web/Claude.md')).toBe(true);
  });

  test('protect: a trailing /** also matches the directory entry itself, not same-named prefixes; without it, no match', () => {
    const dir = globToRegExp('**/scripts/**', { protect: true });
    expect(dir.test('apps/server/src/scripts')).toBe(true);
    expect(dir.test('apps/server/src/scripts/a.sh')).toBe(true);
    expect(dir.test('apps/server/src/scriptsx')).toBe(false);
    expect(globToRegExp('**/scripts/**').test('apps/server/src/scripts')).toBe(false);
    expect(globToRegExp('**/*.config.*', { protect: true }).test('vite.config.ts')).toBe(true);
  });

  test('protect folds by Unicode, without it only ASCII folds', () => {
    expect(globToRegExp('**/scripts/**', { protect: true }).test('\u{17F}cripts/a.sh')).toBe(true);
    expect(globToRegExp('**/scripts/**').test('\u{17F}cripts/a.sh')).toBe(false);
    expect(globToRegExp('**/scripts/**').test('SCRIPTS/a.sh')).toBe(true);
  });
});

describe('protected categories: any depth, case-insensitive, one true and one false each', () => {
  const cases: [string, string, string][] = [
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
    ['error ledger', 'docs/lessons.md', 'docs/lessons-archive.md'],
    ['error ledger entry', 'docs/lessons/1651-probe-reach.md', 'docs/lessonsx/1651.md'],
    ['dispatch template', 'docs/agent-dispatch-prompts.md', 'docs/agent-dispatch.md'],
    ['ADR', 'docs/adr/0021-x.md', 'docs/adrs.md'],
    ['design decisions', 'docs/spec/28-x.md', 'docs/specs.md'],
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

  test('case variants still hit', () => {
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

  test('names containing newlines, carriage returns, spaces or other characters outside the whitelist: always protected (same whitelist as pr-gate SAFE_PATH)', () => {
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

  test('one extra space already counts as protected: in-set source paths themselves hit no protect glob', () => {
    expect(classify([f('apps/server/src/ab.ts')]).protected).toEqual([]);
    const r = classify([f('apps/server/src/a b.ts', { status: 'added' })]);
    expect(r.protected).toEqual(['apps/server/src/a b.ts']);
    expect(r.outsideAutoMerge).toEqual([]);
  });

  test('case-insensitivity folds by Unicode: ſ (U+017F) matches s, K (U+212A) matches k', () => {
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

  test('a trailing /** on a protect glob also matches the same-named directory entry itself (a symlink pointing elsewhere, consistent with pr-gate.js protect)', () => {
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
  test('⑤ security-sensitive surfaces and the migration-running DB bootstrap: every file in the list is protected, never in gateSource', () => {
    for (const p of SECURITY_SURFACES) {
      const r = classify([f(p)]);
      expect(r.protected, p).toEqual([p]);
      expect(r.gateSource, p).toEqual([]);
      expect(r.outsideAutoMerge, p).toEqual([]);
    }
  });

  test('⑤ is case-insensitive like the other protect globs', () => {
    for (const p of ['Apps/Server/src/lib/Secret-Box.ts', 'apps/server/src/DB/Client.ts']) {
      expect(classify([f(p)]).protected, p).toEqual([p]);
    }
  });

  test('⑤ machine*.ts: machines.ts and machine-relay.ts hit; * does not cross directories, machine/x.ts misses', () => {
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

  test('⑤ is anchored at the original path: same-named files nearby or elsewhere can still auto-merge', () => {
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

  const EVAL_SURFACE_PATHS = [
    'integration/eval/adoption/judge.mts',
    'integration/eval/chief-dispatch/grade.mts',
    'integration/eval/memory-regression/grade.mts',
    '.claude/hillclimb/chief-dispatch/cases.json',
    '.claude/hillclimb/memory-regression/_state.json',
    'apps/server/src/trajectory-export.ts',
    'apps/server/src/trajectory-export-cli.ts',
    'apps/server/src/trajectory-outcome.ts',
    'packages/shared/src/trajectory-pack.ts',
  ];
  test('⑥ eval ruler surface: every path is protected and never in gateSource', () => {
    for (const p of EVAL_SURFACE_PATHS) {
      const r = classify([f(p)]);
      expect(r.protected, p).toEqual([p]);
      expect(r.gateSource, p).toEqual([]);
      expect(r.outsideAutoMerge, p).toEqual([]);
    }
  });

  test('⑥ is case-insensitive like the other protect globs', () => {
    for (const p of ['Integration/Eval/X.Mts', '.Claude/Hillclimb/X.json']) {
      expect(classify([f(p)]).protected, p).toEqual([p]);
    }
  });

  test('⑥ lookalikes outside the eval dirs stay in the auto-merge set', () => {
    for (const p of [
      'packages/hillclimb/src/cases.json',
      'apps/server/src/trajectory.ts',
      'apps/server/src/trajectory-attribution.ts',
      'packages/shared/src/trajectory.ts',
    ]) {
      const r = classify([f(p)]);
      expect(r.protected, p).toEqual([]);
      expect(r.outsideAutoMerge, p).toEqual([]);
    }
  });

  test('⑥ same-named dirs outside the protected surface are not protected but still leave the auto-merge set', () => {
    for (const p of ['integration/evalx/judge.mts', 'hillclimb/cases.json']) {
      const r = classify([f(p)]);
      expect(r.protected, p).toEqual([]);
      expect(r.outsideAutoMerge, p).toEqual([p]);
    }
  });

  test('a copy entry original name is classified too: copied out of a protected file counts as a hit', () => {
    const r = classify([
      f('apps/web/src/ci.yml', { status: 'copied', previousFilename: '.github/workflows/ci.yml' }),
    ]);
    expect(r.protected).toEqual(['.github/workflows/ci.yml']);
  });

  test('a rename moving a protected file away: hits by the original path', () => {
    const r = classify([
      f('apps/web/src/moved.yml', {
        status: 'renamed',
        previousFilename: '.github/workflows/ci.yml',
      }),
    ]);
    expect(r.protected).toEqual(['.github/workflows/ci.yml']);
  });

  test('gate sources are listed separately (D4 iv)', () => {
    expect(classify([f('apps/server/src/services/merge-gate/readiness.ts')]).gateSource).toEqual([
      'apps/server/src/services/merge-gate/readiness.ts',
    ]);
    expect(classify([f('apps/daemon/src/merge-decision.ts')]).gateSource).toEqual([
      'apps/daemon/src/merge-decision.ts',
    ]);
  });

  test('ordinary protected paths do not enter gateSource', () => {
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

describe('default deny: anything outside the auto-merge set is left to a human', () => {
  test('product sources, tests, e2e and this ticket evidence are in the set', () => {
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

  test('out-of-set paths (docs, root files, public) are each listed', () => {
    const files = [
      'docs/research/assets/r1/sw.js',
      'docs/research/assets/r1/asset-manifest.json',
      'README.md',
      'CONTEXT.md',
      'apps/web/public/x.svg',
    ];
    expect(classify(files.map((p) => f(p))).outsideAutoMerge).toEqual(files);
  });

  test('auto-merge set globs do not match directory entries themselves: docs/verify or apps/web/src alone counts as out of set', () => {
    for (const p of ['docs/verify', 'apps/web/src', 'apps/server/test', 'integration/test']) {
      const r = classify([f(p, { status: 'added' })]);
      expect(r.protected, p).toEqual([]);
      expect(r.outsideAutoMerge, p).toEqual([p]);
    }
  });

  test('the auto-merge set folds ASCII case only: names that only look in-set after Unicode folding (\u{17F}rc, pac\u{212A}ages) fall outside', () => {
    for (const p of ['apps/web/\u{17F}rc/x.ts', 'pac\u{212A}ages/x/src/a.ts']) {
      const r = classify([f(p, { status: 'added' })]);
      expect(r.protected, p).toEqual([]);
      expect(r.outsideAutoMerge, p).toEqual([p]);
    }
    expect(classify([f('Apps/Web/SRC/x.ts')]).outsideAutoMerge).toEqual([]);
  });

  test('protected paths are not double-recorded as out of set', () => {
    const r = classify([f('.github/workflows/ci.yml')]);
    expect(r.outsideAutoMerge).toEqual([]);
  });

  test('a rename from out of set into the set: recorded out of set by the original path', () => {
    const r = classify([
      f('apps/web/src/x.ts', { status: 'renamed', previousFilename: 'README.md' }),
    ]);
    expect(r.outsideAutoMerge).toEqual(['README.md']);
  });
});

describe('docs-only (#1621): Markdown under docs joins the auto-merge set; design decisions, ADRs and the review guide still stay with the user', () => {
  test('Markdown at any depth under docs is in the set', () => {
    const files = ['docs/ops/langfuse.md', 'docs/README.md', 'docs/a3/x.md', 'docs/research/r1.MD'];
    const r = classify(files.map((p) => f(p)));
    expect(r.protected).toEqual([]);
    expect(r.outsideAutoMerge).toEqual([]);
  });

  test('protected doc paths still match under case or Unicode folds and never land in the set', () => {
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

  test('a name that only looks like docs via Unicode folding lands outside the set', () => {
    const p = 'doc\u{17F}/x.md';
    const r = classify([f(p, { status: 'added' })]);
    expect(r.protected).toEqual([]);
    expect(r.outsideAutoMerge).toEqual([p]);
  });

  test('renaming an ADR into a plain doc counts as protected by its original name', () => {
    const r = classify([
      f('docs/notes/0021.md', { status: 'renamed', previousFilename: 'docs/adr/0021-x.md' }),
    ]);
    expect(r.protected).toEqual(['docs/adr/0021-x.md']);
  });
});

describe('test deletions', () => {
  test('deleting files under test directories, or deleting .test / .spec files', () => {
    const r = classify([
      f('integration/test/helpers.ts', { status: 'removed' }),
      f('apps/web/src/x.test.tsx', { status: 'removed' }),
      f('apps/web/src/x.ts', { status: 'removed' }),
    ]);
    expect(r.deletedTests).toEqual(['integration/test/helpers.ts', 'apps/web/src/x.test.tsx']);
  });

  test('deleted files under e2e/, tests/ and __tests__/ all count, no .test suffix needed', () => {
    const removed = [
      'apps/web/e2e/fixtures/board-helpers.ts',
      'apps/server/tests/helpers.ts',
      'packages/shared/src/__tests__/util.ts',
    ];
    const r = classify(removed.map((p) => f(p, { status: 'removed' })));
    expect(r.deletedTests).toEqual(removed);
  });

  test('.test.mts / .spec.cts and deletions under repo-root test/ and e2e/ all count', () => {
    const removed = [
      'apps/server/src/x.test.mts',
      'packages/shared/src/y.spec.cts',
      'test/helpers.ts',
      'e2e/a.ts',
    ];
    const r = classify(removed.map((p) => f(p, { status: 'removed' })));
    expect(r.deletedTests).toEqual(removed);
  });

  test('test directories and suffixes fold by Unicode (the stricter side): te\u{17F}t/ is a test directory, .te\u{17F}t.ts is a test file', () => {
    const removed = ['apps/server/te\u{17F}t/helpers.ts', 'apps/web/src/x.te\u{17F}t.ts'];
    const r = classify(removed.map((p) => f(p, { status: 'removed' })));
    expect(r.deletedTests).toEqual(removed);
  });

  test('test directories and .test / .spec suffixes are case-insensitive (ADR 0021 D4, consistent with pr-gate /i)', () => {
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

  test('renaming a test to a non-test path also counts as a test deletion', () => {
    const r = classify([
      f('apps/server/src/foo.ts', {
        status: 'renamed',
        previousFilename: 'apps/server/test/foo.test.ts',
      }),
    ]);
    expect(r.deletedTests).toEqual(['apps/server/test/foo.test.ts']);
  });

  test('modifying or adding tests does not count', () => {
    const r = classify([
      f('apps/server/test/a.test.ts'),
      f('apps/server/test/b.test.ts', { status: 'added' }),
    ]);
    expect(r.deletedTests).toEqual([]);
  });

  test('any rename of a test counts as deleting the original (consistent with pr-gate --no-renames), including renames inside test directories to names not collected', () => {
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

describe('evidence directories', () => {
  test('writing this ticket directory is fine, writes into other ticket directories are listed (deletions included)', () => {
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

  test('executables added or changed by this PR are listed, deletions are not', () => {
    const r = classify([
      f('docs/verify/1404/probe.mjs', { status: 'added' }),
      f('docs/verify/1404/run.SH'),
      f('docs/verify/1404/old.py', { status: 'removed' }),
      f('docs/verify/1404/data.json', { status: 'added' }),
    ]);
    expect(r.executableEvidence).toEqual(['docs/verify/1404/probe.mjs', 'docs/verify/1404/run.SH']);
  });

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
  test('every executable extension: added, changed, or renamed onto it inside the evidence directory, all listed', () => {
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

  test('a rename moving another ticket evidence into this ticket directory: listed by the original name', () => {
    const r = classify([
      f('docs/verify/1404/x.json', {
        status: 'renamed',
        previousFilename: 'docs/verify/926/convergence-evidence.json',
      }),
    ]);
    expect(r.otherTicketEvidence).toEqual(['docs/verify/926/convergence-evidence.json']);
  });

  test('a case-changed evidence prefix still checks other tickets and executables; .tsx / .jsx count as executable', () => {
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

  test('the evidence prefix used for other-ticket and executable checks folds by Unicode (the stricter side): doc\u{17F}/verify/1405/x.sh is listed as other-ticket and executable, and falls outside the auto-merge set', () => {
    const name = 'doc\u{17F}/verify/1405/x.sh';
    const r = classify([f(name, { status: 'added' })]);
    expect(r.outsideAutoMerge).toEqual([name]);
    expect(r.otherTicketEvidence).toEqual([name]);
    expect(r.executableEvidence).toEqual([name]);
    const own = classify([f('doc\u{17F}/verify/1404/a.txt', { status: 'added' })]);
    expect(own.otherTicketEvidence).toEqual([]);
  });

  test('a lone docs/verify entry (a symlink standing in for the evidence directory) is listed as other-ticket: empty ticket segment', () => {
    const r = classify([f('docs/verify', { status: 'added' })]);
    expect(r.otherTicketEvidence).toEqual(['docs/verify']);
    expect(r.outsideAutoMerge).toEqual(['docs/verify']);
  });

  test('executable extensions fold by Unicode too: .\u{17F}h and .j\u{17F} count as executable', () => {
    const files = ['docs/verify/1404/x.\u{17F}h', 'docs/verify/1404/y.j\u{17F}'];
    expect(classify(files.map((p) => f(p, { status: 'added' }))).executableEvidence).toEqual(files);
  });

  test('one ticket number a prefix of another: 14040 is not the directory of 1404', () => {
    const r = classify([f('docs/verify/14040/a.txt', { status: 'added' })]);
    expect(r.otherTicketEvidence).toEqual(['docs/verify/14040/a.txt']);
  });

  test('beyond exact case-sensitive matching of the ticket segment there is no guessing: XMON-104 and xmon-104 are two directories', () => {
    const r = classify([f('docs/verify/xmon-104/a.txt', { status: 'added' })], 'XMON-104');
    expect(r.otherTicketEvidence).toEqual(['docs/verify/xmon-104/a.txt']);
  });
});

describe('entries compare leaves without a patch (binary, oversized diff, pure rename)', () => {
  test('those outside the evidence directory are listed as opaque, deletions included; inside the evidence directory they do not count, the prefix is case-sensitive (same clause as the digest)', () => {
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

  test('a rename without a patch: both ends falling outside the evidence directory are listed', () => {
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

describe('executable extensions: the shell, PowerShell, Windows batch and HTML families', () => {
  const families: [string, string[]][] = [
    ['shell', ['.bash', '.zsh', '.fish']],
    ['PowerShell', ['.ps1', '.psm1']],
    ['Windows 批处理', ['.bat', '.cmd']],
    ['HTML（浏览器打开即跑脚本）', ['.html', '.htm']],
  ];
  for (const [family, exts] of families) {
    test(`${family}: ${exts.join(' ')} listed when added, extension case changes count too`, () => {
      const files = exts.flatMap((ext) => [
        `docs/verify/1404/run${ext}`,
        `docs/verify/1404/RUN${ext.toUpperCase()}`,
      ]);
      const r = classify(files.map((p) => f(p, { status: 'added' })));
      expect(r.executableEvidence).toEqual(files);
    });
  }
});

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

describe('chief-dispatch harness paths', () => {
  test('_state.json.harness_paths and CHIEF_DISPATCH_HARNESS_PATHS item-for-item in the same order', () => {
    const st = JSON.parse(
      readFileSync(
        join(import.meta.dirname, '../../../.claude/hillclimb/chief-dispatch/_state.json'),
        'utf8',
      ),
    ) as { harness_paths: string[] };
    expect(st.harness_paths).toEqual([...CHIEF_DISPATCH_HARNESS_PATHS]);
  });

  test('touchesHarness: true inside the list, false outside', () => {
    expect(touchesHarness([f('apps/server/src/services/chief.ts')])).toBe(true);
    expect(touchesHarness([f('packages/shared/src/protocol/chief-tools.ts')])).toBe(true);
    expect(touchesHarness([f('apps/daemon/src/backend/pi.ts')])).toBe(true);
    expect(touchesHarness([f('apps/server/src/services/ci-loop.ts')])).toBe(false);
    expect(
      touchesHarness([
        f('apps/web/src/x.ts', {
          status: 'renamed',
          previousFilename: 'apps/server/src/services/chief.ts',
        }),
      ]),
    ).toBe(true);
  });
});

describe('the same lists as .claude/workflows/pr-gate.js', () => {
  const prGate = () =>
    readFileSync(join(import.meta.dirname, '../../../.claude/workflows/pr-gate.js'), 'utf8');

  test('AUTO_MERGE and AUTO_MERGE_PATH_GLOBS item-for-item in the same order', () => {
    expect(prGateArray(prGate(), 'AUTO_MERGE')).toEqual([...AUTO_MERGE_PATH_GLOBS]);
  });

  test('PROTECTED and PROTECTED_PATH_GLOBS plus MERGE_GATE_SOURCE_GLOBS item-for-item in the same order', () => {
    expect(prGateArray(prGate(), 'PROTECTED')).toEqual([
      ...PROTECTED_PATH_GLOBS,
      ...MERGE_GATE_SOURCE_GLOBS,
    ]);
  });

  test('the parser errors on a missing array, a missing closing ] and unrecognized lines', () => {
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
