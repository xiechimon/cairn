#!/usr/bin/env node
// Runs .claude/workflows/pr-gate.js with stub agents, so its deterministic part
// (args check, D4 routing, skeptic withdraw rule, go) can be checked without
// spending subagents. CI runs it (ci.yml, check job); run it after every
// change to the script (spec 28 §7.5).
// Usage: node scripts/pr-gate-selfcheck.mjs [path to pr-gate.js]
// The failure modes come from pr-gate runs 2-5 on #1410
// (docs/verify/1401/pr-gate-run{2,3,4,5}-*.json).
import { readFileSync } from 'node:fs';

const path = process.argv[2] ?? '.claude/workflows/pr-gate.js';
const body = readFileSync(path, 'utf8').replace(/^export const meta/m, 'const meta');
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const run = new AsyncFunction('args', 'agent', 'parallel', 'pipeline', 'log', 'phase', body);

const HEAD = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

// reviews: {key: partial review}; votes: {key: [vote0, vote1]} (null = skeptic died)
async function gate(args, { reviews = {}, votes = {} } = {}) {
  const agent = async (_prompt, opts) => {
    const [kind, key, i] = opts.label.split(':');
    if (kind === 'review') {
      if (reviews[key] === null) return null;
      return { headSha: HEAD, checked: 'stub', findings: [], ...reviews[key] };
    }
    const v = (votes[key] ?? [])[Number(i)];
    return v === undefined ? { headSha: HEAD, refuted: true, reason: 'stub' } : v;
  };
  const parallel = (thunks) => Promise.all(thunks.map((t) => t().catch(() => null)));
  const pipeline = (items, ...stages) =>
    Promise.all(
      items.map(async (item, idx) => {
        let r = item;
        for (const s of stages) r = await s(r, item, idx);
        return r;
      }),
    );
  return run(
    args,
    agent,
    parallel,
    pipeline,
    () => {},
    () => {},
  );
}

const base = {
  pr: 1,
  ticket: 2,
  headSha: HEAD,
  changedFiles: ['apps/server/src/x.ts'],
  deletedFiles: [],
  linesChanged: 10,
};
const safetyFiles = (files) => ({ safety: { changedFiles: files } });
const blocker = { title: 'bug', severity: 'blocking', failurePath: 'x' };

const cases = [
  [
    'clean change: go, auto-merge',
    async () => {
      const r = await gate(base, { reviews: safetyFiles(base.changedFiles) });
      return r.go === true && r.mergedBy === 'auto-merge';
    },
  ],
  [
    'C-quoted path (core.quotePath on) is rejected',
    async () => {
      try {
        await gate({ ...base, changedFiles: ['"docs/adr/0021-\\350\\207\\252.md"'] });
        return false;
      } catch (e) {
        return /quotePath/.test(String(e));
      }
    },
  ],
  [
    'unquoted non-ASCII ADR path routes to the user',
    async () => {
      const files = ['docs/adr/0021-自治合并.md'];
      const r = await gate({ ...base, changedFiles: files }, { reviews: safetyFiles(files) });
      return r.mergedBy === 'user' && r.protectedPaths.includes(files[0]);
    },
  ],
  [
    'CI-called script outside the *gate* glob routes to the user',
    async () => {
      const files = ['scripts/lint-warning-cap.mjs'];
      const r = await gate({ ...base, changedFiles: files }, { reviews: safetyFiles(files) });
      return r.mergedBy === 'user';
    },
  ],
  [
    'rename out of a protected path (list built without --no-renames) is caught',
    async () => {
      const r = await gate(
        { ...base, changedFiles: ['biome.jsonc'] },
        { reviews: safetyFiles(['biome.json', 'biome.jsonc']) },
      );
      return r.go === false && r.unlistedFiles?.includes('biome.json') && r.mergedBy === 'user';
    },
  ],
  [
    'deletedFiles and linesChanged are each required',
    async () => {
      const { deletedFiles: _d, ...noDeleted } = base;
      const { linesChanged: _l, ...noLines } = base;
      for (const args of [noDeleted, noLines]) {
        try {
          await gate(args);
          return false;
        } catch (e) {
          if (!/^Error: pr-gate args/.test(String(e))) return false;
        }
      }
      return true;
    },
  ],
  [
    'deleted test file routes to the user',
    async () => {
      const files = ['apps/server/test/foo.test.ts'];
      const r = await gate(
        { ...base, changedFiles: files, deletedFiles: files },
        { reviews: safetyFiles(files) },
      );
      return r.mergedBy === 'user' && r.humanReasons.some((x) => x.includes('foo.test.ts'));
    },
  ],
  [
    'over 800 lines routes to the user',
    async () => {
      const r = await gate(
        { ...base, linesChanged: 801 },
        { reviews: safetyFiles(base.changedFiles) },
      );
      return r.mergedBy === 'user';
    },
  ],
  [
    'over 40 files routes to the user',
    async () => {
      const files = Array.from({ length: 41 }, (_, i) => `apps/web/src/f${i}.ts`);
      const r = await gate({ ...base, changedFiles: files }, { reviews: safetyFiles(files) });
      return r.mergedBy === 'user';
    },
  ],
  [
    'linesChanged must be a non-negative integer',
    async () => {
      for (const linesChanged of [Number.NaN, -1, 1.5]) {
        try {
          await gate({ ...base, linesChanged });
          return false;
        } catch {}
      }
      return true;
    },
  ],
  [
    'a path with a shell character is rejected',
    async () => {
      try {
        await gate({ ...base, changedFiles: ['docs/x;rm -rf .md'] });
        return false;
      } catch (e) {
        return /review this PR by hand/.test(String(e));
      }
    },
  ],
  [
    'CI gate helpers and data anywhere under scripts/ route to the user',
    async () => {
      const files = [
        'scripts/ui-normalize.mjs',
        'scripts/ui-registry.json',
        'scripts/ui-upstream-snapshots.json',
      ];
      const r = await gate({ ...base, changedFiles: files }, { reviews: safetyFiles(files) });
      return r.mergedBy === 'user' && files.every((f) => r.protectedPaths.includes(f));
    },
  ],
  [
    'gate files outside root scripts/ route to the user (run 4)',
    async () => {
      const files = [
        'apps/web/src/biome.json',
        'apps/server/biome.jsonc',
        '.gitignore',
        'apps/server/src/.gitignore',
        'apps/server/scripts/db-check.mjs',
        'apps/server/drizzle.config.ts',
      ];
      const r = await gate({ ...base, changedFiles: files }, { reviews: safetyFiles(files) });
      return files.every((f) => r.protectedPaths.includes(f));
    },
  ],
  [
    'files that steer agents route to the user (run 4)',
    async () => {
      const files = [
        '.claude/settings.json',
        '.claude/hooks/pre.sh',
        '.claude/skills/pr-pacman/SKILL.md',
        'apps/web/CLAUDE.md',
        'apps/server/AGENTS.md',
        'docs/pr-review.md',
      ];
      const r = await gate({ ...base, changedFiles: files }, { reviews: safetyFiles(files) });
      return files.every((f) => r.protectedPaths.includes(f));
    },
  ],
  [
    'a path a reviewer adds to protectedPaths routes to the user',
    async () => {
      const r = await gate(base, {
        reviews: {
          ...safetyFiles(base.changedFiles),
          correctness: { protectedPaths: ['apps/server/src/x.ts'] },
        },
      });
      return r.mergedBy === 'user' && r.protectedPaths.includes('apps/server/src/x.ts');
    },
  ],
  [
    'product source, tests, e2e and evidence do not route to the user',
    async () => {
      const files = [
        'apps/server/src/services/ci-loop.ts',
        'apps/server/test/ci-loop.test.ts',
        'apps/web/e2e/board.spec.ts',
        'packages/shared/src/records/review.ts',
        'integration/test/m5.test.ts',
        'docs/verify/1404/run.txt',
      ];
      const r = await gate({ ...base, changedFiles: files }, { reviews: safetyFiles(files) });
      return r.mergedBy === 'auto-merge' && r.go === true;
    },
  ],
  [
    'paths outside the auto-merge set route to the user (run 5)',
    async () => {
      for (const f of [
        'docs/spec/28-x.md',
        'README.md',
        'CONTEXT.md',
        'apps/web/public/x.svg',
        'integration/eval/x.ts',
      ]) {
        const r = await gate({ ...base, changedFiles: [f] }, { reviews: safetyFiles([f]) });
        if (
          r.mergedBy !== 'user' ||
          !r.humanReasons.some((x) => x.includes('outside the auto-merge set') && x.includes(f))
        )
          return false;
      }
      return true;
    },
  ],
  [
    'agent-steering files the name list missed route to the user (run 5)',
    async () => {
      const files = [
        'AGENTS.override.md',
        'AGENTS.MD',
        'CLAUDE.local.md',
        '.pi/skills/x/SKILL.md',
        'apps/web/.claude/skills/x/SKILL.md',
        'apps/server/src/.claude/settings.json',
        '.cursor/skills/verify-pacman/SKILL.md',
        '.mcp.json',
        '.ckignore',
      ];
      for (const f of files) {
        const r = await gate({ ...base, changedFiles: [f] }, { reviews: safetyFiles([f]) });
        if (r.mergedBy !== 'user' || !r.protectedPaths.includes(f)) return false;
      }
      return true;
    },
  ],
  [
    'case variants of protected paths route to the user (run 5)',
    async () => {
      for (const f of [
        '.Claude/settings.json',
        '.Husky/pre-commit',
        'apps/web/src/Claude.md',
        'apps/server/src/Scripts/x.mjs',
      ]) {
        const r = await gate({ ...base, changedFiles: [f] }, { reviews: safetyFiles([f]) });
        if (r.mergedBy !== 'user' || !r.protectedPaths.includes(f)) return false;
      }
      return true;
    },
  ],
  [
    'a protected path only the safety reviewer lists is matched (run 5)',
    async () => {
      const r = await gate(base, {
        reviews: safetyFiles([...base.changedFiles, '.github/workflows/ci.yml']),
      });
      return (
        r.go === false &&
        r.mergedBy === 'user' &&
        r.protectedPaths.includes('.github/workflows/ci.yml')
      );
    },
  ],
  [
    'a deleted test helper (test directory only) routes to the user (run 5)',
    async () => {
      const files = ['integration/test/helpers.ts'];
      const r = await gate(
        { ...base, changedFiles: files, deletedFiles: files },
        { reviews: safetyFiles(files) },
      );
      return (
        r.mergedBy === 'user' &&
        r.humanReasons.some((x) => x.startsWith('deleted test files') && x.includes('helpers.ts'))
      );
    },
  ],
  [
    'a deleted colocated test (suffix only) routes to the user (run 5)',
    async () => {
      const files = ['apps/web/src/x.test.tsx'];
      const r = await gate(
        { ...base, changedFiles: files, deletedFiles: files },
        { reviews: safetyFiles(files) },
      );
      return (
        r.mergedBy === 'user' &&
        r.humanReasons.some((x) => x.startsWith('deleted test files') && x.includes('x.test.tsx'))
      );
    },
  ],
  [
    'a deleted path missing from changedFiles is an args error (run 5)',
    async () => {
      try {
        await gate({ ...base, deletedFiles: ['apps/server/src/gone.ts'] });
        return false;
      } catch (e) {
        return /^Error: pr-gate args/.test(String(e));
      }
    },
  ],
  [
    'pr and ticket must be positive integers (run 5)',
    async () => {
      for (const bad of [{ pr: 1410.5 }, { pr: 0 }, { ticket: -3 }]) {
        try {
          await gate({ ...base, ...bad });
          return false;
        } catch (e) {
          if (!/^Error: pr-gate args/.test(String(e))) return false;
        }
      }
      return true;
    },
  ],
  [
    'a path with a quote or space is rejected (run 5)',
    async () => {
      for (const f of ["x' --output=y 'z", 'docs/a b.md']) {
        try {
          await gate({ ...base, changedFiles: [f] });
          return false;
        } catch (e) {
          if (!/review this PR by hand/.test(String(e))) return false;
        }
      }
      return true;
    },
  ],
  [
    'configs CI runs under route to the user, at the root too',
    async () => {
      const files = [
        'package.json',
        'vitest.config.ts',
        'apps/web/playwright.config.ts',
        'apps/server/tsconfig.json',
        'pnpm-workspace.yaml',
      ];
      const r = await gate({ ...base, changedFiles: files }, { reviews: safetyFiles(files) });
      return files.every((f) => r.protectedPaths.includes(f));
    },
  ],
  [
    'a deletion only the safety reviewer reports routes to the user',
    async () => {
      const files = ['apps/web/e2e/board.spec.ts'];
      const r = await gate(
        { ...base, changedFiles: files, deletedFiles: [] },
        { reviews: { safety: { changedFiles: files, deletedFiles: files } } },
      );
      return r.mergedBy === 'user' && r.humanReasons.some((x) => x.includes('board.spec.ts'));
    },
  ],
  [
    'a larger line count from the safety reviewer routes to the user',
    async () => {
      const r = await gate(base, {
        reviews: { safety: { changedFiles: base.changedFiles, linesChanged: 900 } },
      });
      return r.mergedBy === 'user';
    },
  ],
  [
    'a reviewer that returns nothing blocks go',
    async () => {
      const r = await gate(base, { reviews: { ...safetyFiles(base.changedFiles), tests: null } });
      return r.go === false && r.missing.includes('tests');
    },
  ],
  [
    'findings past the skeptic cap are kept',
    async () => {
      const refute = { headSha: HEAD, refuted: true, reason: 'no' };
      const r = await gate(base, {
        reviews: {
          ...safetyFiles(base.changedFiles),
          correctness: { findings: [blocker, blocker, blocker] },
        },
        votes: { correctness: [refute, refute] },
      });
      return (
        r.go === false &&
        r.blocking.length === 1 &&
        r.blocking[0].skeptics === 'skipped: cap reached'
      );
    },
  ],
  [
    'two skeptics refuting on the head withdraw the finding',
    async () => {
      const r = await gate(base, {
        reviews: { ...safetyFiles(base.changedFiles), correctness: { findings: [blocker] } },
        votes: {
          correctness: [
            { headSha: HEAD, refuted: true, reason: 'no' },
            { headSha: HEAD, refuted: true, reason: 'no' },
          ],
        },
      });
      return r.go === true && r.blocking.length === 0;
    },
  ],
  [
    'two skeptics confirming on the head keep the finding (run 5)',
    async () => {
      const confirm = { headSha: HEAD, refuted: false, reason: 'real' };
      const r = await gate(base, {
        reviews: { ...safetyFiles(base.changedFiles), correctness: { findings: [blocker] } },
        votes: { correctness: [confirm, confirm] },
      });
      return r.go === false && r.blocking.length === 1;
    },
  ],
  [
    'a split vote keeps the finding (run 5)',
    async () => {
      const r = await gate(base, {
        reviews: { ...safetyFiles(base.changedFiles), correctness: { findings: [blocker] } },
        votes: {
          correctness: [
            { headSha: HEAD, refuted: true, reason: 'no' },
            { headSha: HEAD, refuted: false, reason: 'real' },
          ],
        },
      });
      return r.go === false && r.blocking.length === 1;
    },
  ],
  [
    'a dead skeptic keeps the finding',
    async () => {
      const r = await gate(base, {
        reviews: { ...safetyFiles(base.changedFiles), correctness: { findings: [blocker] } },
        votes: { correctness: [{ headSha: HEAD, refuted: true, reason: 'no' }, null] },
      });
      return r.go === false && r.blocking.length === 1;
    },
  ],
  [
    'skeptics that saw another head do not withdraw the finding',
    async () => {
      const r = await gate(base, {
        reviews: { ...safetyFiles(base.changedFiles), correctness: { findings: [blocker] } },
        votes: {
          correctness: [
            { headSha: OTHER, refuted: true, reason: 'moved' },
            { headSha: OTHER, refuted: true, reason: 'moved' },
          ],
        },
      });
      return r.go === false && r.blocking.length === 1 && r.shaMismatch.length > 0;
    },
  ],
  [
    'a reviewer on another head blocks go',
    async () => {
      const r = await gate(base, {
        reviews: { ...safetyFiles(base.changedFiles), rules: { headSha: OTHER } },
      });
      return r.go === false && r.shaMismatch.some((m) => m.dimension === 'rules');
    },
  ],
  [
    'a missing safety file list blocks go',
    async () => {
      const r = await gate(base);
      return r.go === false;
    },
  ],
];

let failed = 0;
for (const [name, fn] of cases) {
  let ok = false;
  let err = '';
  try {
    ok = await fn();
  } catch (e) {
    err = ` (${String(e).slice(0, 120)})`;
  }
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${err}`);
}
console.log(`${cases.length - failed}/${cases.length} passed (${path})`);
process.exit(failed === 0 ? 0 : 1);
