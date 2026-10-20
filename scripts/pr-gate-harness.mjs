#!/usr/bin/env node
// Runs .claude/workflows/pr-gate.js with stub agents, so its deterministic part
// (args check, D4 routing, skeptic withdraw rule, go) can be checked without
// spending subagents. Run it after every change to the script (spec 28 §7.5).
// Usage: node scripts/pr-gate-harness.mjs [path to pr-gate.js]
// The failure modes come from pr-gate runs 2 and 3 on #1410
// (docs/verify/1401/pr-gate-run2-7f0b544.json, pr-gate-run3-3b0da7b.json).
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
    'deletedFiles and linesChanged are required',
    async () => {
      const { deletedFiles: _d, linesChanged: _l, ...rest } = base;
      try {
        await gate(rest);
        return false;
      } catch {
        return true;
      }
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
        return /shell character/.test(String(e));
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
