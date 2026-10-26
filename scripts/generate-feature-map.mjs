#!/usr/bin/env node

// Feature map generator (#894). Writes docs/feature-map.md — the living
// register of what exists, at which tier, in which state, anchored to which
// verification artifact. Every cell is extracted; nothing is hand-edited on
// either side. To change the map, change the rules below and re-run.
//
// Row sources (union of ticket numbers, normalized — leading zeros dropped):
//   1. `#NNN` references inside docs/spec/*.md (the generated doc lives
//      outside docs/spec/, so the output never feeds back into the input).
//   2. Numeric directory names under docs/verify/ (landed acceptance evidence).
//   3. `#NNN` references inside the CI test surface: *.test.ts / *.test.tsx /
//      *.spec.ts under apps/, packages/, integration/ (skipping node_modules,
//      dist, coverage, test-results, playwright-report).
//
// Title + state come from `gh api repos/<owner>/<repo>/issues?state=all`
// (paginated; the REST issues endpoint returns PRs too). PR-typed numbers do
// not become rows — the row set follows the `gh issue list` notion of a
// ticket; PRs are listed in the gap section instead. Numbers that resolve to
// nothing land in the gap section as well.
//
// Anchors per row: docs/verify/<num>/ when the directory exists, plus every
// test file that references the number. A row with neither is marked
// `[未验证]`. Tier and status follow the rule tables rendered into §0 of the
// doc; the regexes below are the single source for those tables.
//
// The output is a pure function of the working tree + GitHub state: no
// timestamps, no run metadata, all ordering explicit (tickets ascending,
// paths lexicographic, tiers in TIER_ORDER). Two consecutive runs write
// byte-identical files.
//
// Usage:
//   node scripts/generate-feature-map.mjs           # regenerate the doc
//   node scripts/generate-feature-map.mjs --check   # exit 1 if the on-disk doc differs
//
// Prereq: `gh` on PATH, authenticated, api.github.com reachable.
// Exit 0 on success (or a clean --check); exit 1 on any failure. A failed run
// never writes a partial doc.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { loadRepoEvalCoverage, renderEvalCoverage } from './eval-coverage.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const DOC_NAME = 'feature-map.md';
const DOC_REL = join('docs', DOC_NAME);
const DOC_PATH = join(REPO_ROOT, DOC_REL);

// Ticket reference: `#` + 2-4 digits, not followed by another hex digit (so a
// 4-digit hex color literal like `#1234ab`'s prefix never matches, while
// `#123 ` and `#123）` do).
const REF_SOURCE = '#(\\d{2,4})(?![0-9a-fA-F])';

const TEST_ROOTS = ['apps', 'packages', 'integration'];
const TEST_SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'coverage',
  'test-results',
  'playwright-report',
]);
const TEST_SUFFIXES = ['.test.ts', '.test.tsx', '.spec.ts'];

// Tier vocabulary and semantics: docs/spec/18-positioning-and-differentiation.md (the `差异化面` tier = the
// three semantic-axis cores — two hard gates, AI review with teeth, versioned
// plan documents; the `运行轴` tier = the runtime model — machine × CLI, daemon,
// self-hosted orchestration; the `通用面` tier = everything else). Classification is a
// title keyword match, first rule wins, not a semantic judgment — §0.6 of the
// doc states this limitation.
const TIER_ORDER = ['Differentiation surface', 'Runtime axis', 'General surface'];
const TIER_RULES = [
  [
    'Differentiation surface',
    /闸|gate|confirm|review|审核|方案|plan|驳回|reject|revision|verdict|相位|phase/i,
  ],
  [
    'Runtime axis',
    /机器|machine|daemon|runtime|执行|executor|worktree|自托管|部署|deploy|enroll|claim|亲和|affinity|沙箱|sandbox|编排|orchestrat|会话|session|跨机|钉选|多机|cli|pin/i,
  ],
];

function fail(message) {
  process.stderr.write(`generate-feature-map: ${message}\n`);
  process.exit(1);
}

function refMatches(text) {
  const re = new RegExp(REF_SOURCE, 'g');
  const nums = new Set();
  for (const m of text.matchAll(re)) nums.add(String(Number(m[1])));
  return nums;
}

function addToIndex(index, num, source) {
  if (!index.has(num)) index.set(num, new Set());
  index.get(num).add(source);
}

// Source 1: spec volume references.
function collectSpecRefs() {
  const dir = join(REPO_ROOT, 'docs', 'spec');
  const refs = new Map();
  for (const name of readdirSync(dir)
    .filter((n) => n.endsWith('.md'))
    .sort()) {
    const relPath = `docs/spec/${name}`;
    for (const num of refMatches(readFileSync(join(dir, name), 'utf8'))) {
      addToIndex(refs, num, relPath);
    }
  }
  return refs;
}

// Source 2: landed evidence directories.
function collectVerifyDirs() {
  const dir = join(REPO_ROOT, 'docs', 'verify');
  const numeric = new Map();
  const other = new Map();
  if (!existsSync(dir)) return { numeric, other };
  const place = (name, anchor) => {
    if (/^\d+$/.test(name)) numeric.set(String(Number(name)), anchor);
    else other.set(name, anchor);
  };
  const ledgerPath = join(dir, 'pruned.json');
  if (existsSync(ledgerPath)) {
    for (const [name, sha] of Object.entries(JSON.parse(readFileSync(ledgerPath, 'utf8')))) {
      place(name, `${sha.slice(0, 9)}:docs/verify/${name}/`);
    }
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) place(entry.name, `docs/verify/${entry.name}/`);
  }
  return {
    numeric,
    other: new Map([...other].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
  };
}

function walkTestFiles(dir, out) {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : 1,
  );
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (TEST_SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      walkTestFiles(full, out);
    } else if (TEST_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) {
      out.push(full);
    }
  }
  return out;
}

// Source 3: the CI test surface (vitest light + integration projects and the
// playwright e2e specs are exactly these files; see root vitest.config.ts and
// .github/workflows/ci.yml).
function collectTestRefs() {
  const refs = new Map();
  let fileCount = 0;
  for (const root of TEST_ROOTS) {
    const abs = join(REPO_ROOT, root);
    if (!existsSync(abs)) continue;
    for (const file of walkTestFiles(abs, [])) {
      fileCount += 1;
      const relPath = relative(REPO_ROOT, file);
      for (const num of refMatches(readFileSync(file, 'utf8'))) {
        addToIndex(refs, num, relPath);
      }
    }
  }
  return { refs, fileCount };
}

function gh(args) {
  try {
    return execFileSync('gh', args, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const detail = err?.stderr ? String(err.stderr).trim() : String(err?.message);
    fail(
      `\`gh ${args[0]} ${args[1] ?? ''}…\` failed: ${detail}\n` +
        'prereq: gh on PATH, authenticated (gh auth status), api.github.com reachable.',
    );
  }
}

function fetchTickets() {
  const repo = gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']).trim();
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) fail(`could not resolve the repo slug (got "${repo}")`);
  const out = gh([
    'api',
    `repos/${repo}/issues?state=all&per_page=100`,
    '--paginate',
    '--jq',
    '.[] | {number, state, state_reason, pr: has("pull_request"), title} | @json',
  ]);
  const tickets = new Map();
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      fail(`unparsable line from gh api: ${line.slice(0, 120)}…`);
    }
    tickets.set(String(rec.number), rec);
  }
  if (tickets.size === 0)
    fail('gh api returned zero issues/PRs; refusing to build a map from an empty fetch');
  return { repo, tickets };
}

// CI execution surface: job ids and their named steps, straight from the
// workflow file. This is where the test-file anchors actually run.
function collectCiSurface() {
  const file = join(REPO_ROOT, '.github', 'workflows', 'ci.yml');
  const jobs = [];
  if (!existsSync(file)) return jobs;
  let inJobs = false;
  let current = null;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true;
      continue;
    }
    if (!inJobs) continue;
    if (/^[^\s#]/.test(line)) break; // dedent out of the jobs: block
    const job = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (job) {
      current = { id: job[1], steps: [] };
      jobs.push(current);
      continue;
    }
    const step = line.match(/^\s+- name: (.+?)\s*$/);
    if (step && current) current.steps.push(step[1]);
  }
  return jobs;
}

function classifyTier(title) {
  for (const [tier, re] of TIER_RULES) {
    if (re.test(title)) return tier;
  }
  return 'General surface';
}

function cell(text) {
  return String(text)
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
}

function byNum(a, b) {
  return Number(a) - Number(b);
}

function issueUrl(repo, num) {
  return `https://github.com/${repo}/issues/${num}`;
}

// ---------------------------------------------------------------------------
// Collect + join
// ---------------------------------------------------------------------------

const mode = process.argv[2];
if (mode !== undefined && mode !== '--check') {
  fail(`unknown argument "${mode}" (usage: generate-feature-map.mjs [--check])`);
}
const checkOnly = mode === '--check';

let coverage;
try {
  coverage = loadRepoEvalCoverage(REPO_ROOT);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
if (coverage.unlisted.length > 0) {
  fail(
    `hillclimb flow ${coverage.unlisted.map((name) => `"${name}"`).join(', ')} has no capability row`,
  );
}

const specRefs = collectSpecRefs();
const { numeric: verifyNumeric, other: verifyOther } = collectVerifyDirs();
const { refs: testRefs, fileCount: testFileCount } = collectTestRefs();
const { repo, tickets } = fetchTickets();
const ciJobs = collectCiSurface();

const union = [...new Set([...specRefs.keys(), ...verifyNumeric.keys(), ...testRefs.keys()])];

const rows = [];
const prRefs = [];
const unresolved = [];
for (const num of union.sort(byNum)) {
  const rec = tickets.get(num);
  const sources = {
    spec: [...(specRefs.get(num) ?? [])].sort(),
    tests: [...(testRefs.get(num) ?? [])].sort(),
    verify: verifyNumeric.has(num),
  };
  if (!rec) {
    unresolved.push({ num, sources });
    continue;
  }
  if (rec.pr) {
    prRefs.push({ num, rec, sources });
    continue;
  }
  const anchors = [];
  if (verifyNumeric.has(num)) anchors.push(verifyNumeric.get(num));
  anchors.push(...sources.tests);
  const anchored = anchors.length > 0;
  const status =
    rec.state === 'closed'
      ? anchored
        ? 'Done'
        : 'Unverified'
      : anchored
        ? 'In progress'
        : 'Not started';
  rows.push({
    num,
    title: rec.title,
    tier: classifyTier(rec.title),
    status,
    anchors,
    anchored,
    sources,
  });
}

rows.sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) || byNum(a.num, b.num));

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

const out = [];
out.push('# Feature map (living register of current state)');
out.push('');
out.push(
  '> This register is mechanically extracted by `scripts/generate-feature-map.mjs` — do not hand-edit; changing the rules = changing the script and re-running (#894 established the first-version rules).',
);
out.push(
  '> Regenerate: `node scripts/generate-feature-map.mjs`; verify the on-disk copy against its sources: add `--check`.',
);
out.push('> Prereq: `gh` authenticated, api.github.com reachable.');
out.push(
  '> Division of labor with volume 03: 03-ROADMAP = the historical register of build order; this register = the living register of current state.',
);
out.push(
  '> Numbering note: this once occupied spec sequence number 22 and was renumbered to 25 after a collision (#952); from #1527 it left the numbered sequence and moved to `docs/feature-map.md` (generated artifacts do not consume hand-written volume numbers).',
);
out.push('');
out.push('## 0. Extraction rules');
out.push('');
out.push(
  'All rules are mechanically re-runnable with no per-line manual editing. The canonical text = the script itself; this section is rendered by the script.',
);
out.push('');
out.push('### 0.1 Rows and columns');
out.push('');
out.push(
  'A row = the union of ticket numbers (three sources, numbers normalized numerically with leading zeros dropped):',
);
out.push('');
out.push(
  `1. \`${REF_SOURCE}\` references inside \`docs/spec/*.md\` — the negative lookahead excludes hexadecimal color literals;`,
);
out.push('2. purely numeric directory names under `docs/verify/` (landed acceptance evidence);');
out.push(
  `3. ticket references in the CI test surface (${TEST_SUFFIXES.join(' / ')} under ${TEST_ROOTS.join(' / ')}, skipping ${[...TEST_SKIP_DIRS].sort().join(' / ')}).`,
);
out.push('');
out.push(
  'Titles and states come from `gh api repos/<owner>/<repo>/issues?state=all` (PRs included). The row set follows the `gh issue list` notion and only includes issues; referenced PR numbers do not become rows (listed in §3.2), and numbers that resolve to nothing land in §3.3.',
);
out.push('');
out.push(
  'Four columns: Feature = `#ticket` + the issue title verbatim (backtick-quoted, since legacy titles are Chinese); Tier = §0.2; Status = §0.3; Verification anchors = §0.4.',
);
out.push('');
out.push('### 0.2 Tier rules (per volume 18)');
out.push('');
out.push(
  'The tier vocabulary comes from `docs/spec/18-positioning-and-differentiation.md` (`差异化面` / `运行轴` / `通用面`).',
);
out.push(
  'Judgment = title keyword match, first rule in the table wins, and no match = General surface:',
);
out.push('');
out.push('| Tier | Title regex (canonical in the script) |');
out.push('|---|---|');
for (const [tier, re] of TIER_RULES) {
  out.push(`| ${tier} | \`/${re.source}/${re.flags}\` |`);
}
out.push('');
out.push('### 0.3 Status rules');
out.push('');
out.push('| issue state | has verification anchor | no verification anchor |');
out.push('|---|---|---|');
out.push('| closed | Done | Unverified |');
out.push('| open | In progress | Not started |');
out.push('');
out.push('### 0.4 Verification anchor rules');
out.push('');
out.push(
  '- the directory `docs/verify/<ticket>/` exists → that path becomes an anchor; directories already pruned from the working tree by the weekly cleanup (`docs/verify/pruned.json`) → `<sha>:docs/verify/<ticket>/` becomes an anchor, readable via `git show`;',
);
out.push(
  '- files referencing the ticket in the CI test surface → each path becomes an anchor (these files are executed by the CI jobs in §0.5);',
);
out.push(
  '- neither → the anchor column is marked `[unverified]` and the row enters the §3.1 follow-up list.',
);
out.push('');
out.push('### 0.5 CI execution surface (extracted from `.github/workflows/ci.yml`)');
out.push('');
if (ciJobs.length > 0) {
  out.push('| job | named steps |');
  out.push('|---|---|');
  for (const job of ciJobs) {
    out.push(
      `| \`${job.id}\` | ${job.steps.map((s) => `\`${cell(s).replace(/`/g, '')}\``).join(' / ')} |`,
    );
  }
} else {
  out.push('(`.github/workflows/ci.yml` not found.)');
}
out.push('');
out.push('### 0.6 Known limitations (recorded as-is in the first version)');
out.push('');
out.push(
  '1. Reference detection is a line-level regex that does not exclude code fences: a `#NNN` inside a spec code block is also collected as a reference.',
);
out.push(
  '2. Tiers are title keyword matches with no semantic judgment — homonyms are not distinguished (`闸` is both a product hard gate and a CI gate name, and `review` is both AI review and ordinary code review). A wrongly tiered row = rule noise; refining the two §0.2 regexes is follow-up work.',
);
out.push(
  '3. Status does not read `state_reason`: tickets closed as wontfix / not_planned are likewise recorded as "Done".',
);
out.push(
  '4. The Feature column = the issue title verbatim. After a ticket is opened, the behavior may still evolve and the title does not follow.',
);
out.push(
  '5. The row set = tickets referenced by the three sources. Features never ticketed, or ticketed but referenced by neither spec / tests / evidence, are not in this register.',
);
out.push(
  '6. The GitHub data is a snapshot at generation time; when a source changes, re-running updates it (that is how a living register updates). "Two consecutive runs agree" means byte-identical only while the sources are unchanged.',
);
out.push('');

// §1 statistics
const tierCount = new Map(TIER_ORDER.map((t) => [t, 0]));
const statusCount = new Map([
  ['Done', 0],
  ['In progress', 0],
  ['Not started', 0],
  ['Unverified', 0],
]);
let withVerify = 0;
let withTests = 0;
let withBoth = 0;
let withNone = 0;
for (const row of rows) {
  tierCount.set(row.tier, tierCount.get(row.tier) + 1);
  statusCount.set(row.status, statusCount.get(row.status) + 1);
  const v = row.sources.verify;
  const t = row.sources.tests.length > 0;
  if (v && t) withBoth += 1;
  else if (v) withVerify += 1;
  else if (t) withTests += 1;
  else withNone += 1;
}
// Distinct spec files that contributed a reference. Deliberately NOT a count
// of fetched tickets: that number moves whenever anyone opens any issue, and
// the doc must only change when a source of the map changes.
const specFileCount = new Set([...specRefs.values()].flatMap((s) => [...s])).size;

out.push('## 1. Statistics');
out.push('');
out.push('| Item | Count |');
out.push('|---|---|');
out.push(`| Map rows (issues) | ${rows.length} |`);
for (const tier of TIER_ORDER) {
  out.push(`| of which ${tier} | ${tierCount.get(tier)} |`);
}
for (const status of ['Done', 'In progress', 'Not started', 'Unverified']) {
  out.push(`| status ${status} | ${statusCount.get(status)} |`);
}
out.push(`| anchors = evidence directory + test reference | ${withBoth} |`);
out.push(`| anchors = evidence directory only | ${withVerify} |`);
out.push(`| anchors = test reference only | ${withTests} |`);
out.push(`| no anchor (\`[unverified]\`) | ${withNone} |`);
out.push(`| referenced PRs (no rows, §3.2) | ${prRefs.length} |`);
out.push(`| unresolvable ticket numbers (§3.3) | ${unresolved.length} |`);
out.push(
  `| evidence directories that are not GitHub ticket numbers (§3.4) | ${verifyOther.size} |`,
);
out.push(`| scan surface: spec volumes / test files | ${specFileCount} / ${testFileCount} |`);
out.push('');

// §2 the map
out.push('## 2. Feature map');
out.push('');
out.push(`Ordering: by tier (${TIER_ORDER.join(' → ')}), tickets ascending within a tier.`);
out.push('');
out.push('| Feature | Tier | Status | Verification anchors |');
out.push('|---|---|---|---|');
for (const row of rows) {
  const feature = `[#${row.num}](${issueUrl(repo, row.num)}) \`${cell(row.title).replace(/`/g, '')}\``;
  const anchor = row.anchored ? row.anchors.map((a) => `\`${a}\``).join('<br>') : '[unverified]';
  out.push(`| ${feature} | ${row.tier} | ${row.status} | ${anchor} |`);
}
out.push('');

// §3 gaps
out.push('## 3. Rows without anchors and rows that cannot be resolved (follow-up work)');
out.push('');
out.push('### 3.1 `[unverified]` rows');
out.push('');
out.push(
  'These rows have neither a `docs/verify/<ticket>/` directory nor a CI-test-surface file referencing the ticket — the feature claim comes from the spec volumes, but there is no verification anchor to point at. Adding an anchor = adding verify evidence or a test reference.',
);
out.push('');
const unverified = rows.filter((r) => !r.anchored);
if (unverified.length === 0) {
  out.push('(None.)');
} else {
  out.push('| Ticket | Feature | Spec volumes referencing it |');
  out.push('|---|---|---|');
  for (const row of unverified) {
    out.push(
      `| [#${row.num}](${issueUrl(repo, row.num)}) | \`${cell(row.title).replace(/`/g, '')}\` | ${row.sources.spec.map((s) => `\`${s}\``).join('<br>')} |`,
    );
  }
}
out.push('');
out.push('### 3.2 Referenced PRs (no rows)');
out.push('');
out.push(
  'The row-set criterion = issues (§0.1). These PR numbers are referenced by the three sources; their implementations sit under the corresponding issue rows.',
);
out.push('');
if (prRefs.length === 0) {
  out.push('(None.)');
} else {
  out.push('| PR | Title | State | Referenced by |');
  out.push('|---|---|---|---|');
  for (const { num, rec, sources } of prRefs) {
    const src = [];
    if (sources.spec.length > 0) src.push(`spec ×${sources.spec.length}`);
    if (sources.tests.length > 0) src.push(`tests ×${sources.tests.length}`);
    out.push(
      `| [#${num}](https://github.com/${repo}/pull/${num}) | \`${cell(rec.title).replace(/`/g, '')}\` | ${rec.state === 'closed' ? 'closed' : 'open'} | ${src.join(' + ')} |`,
    );
  }
}
out.push('');
out.push('### 3.3 Unresolvable ticket numbers');
out.push('');
out.push(
  'These numbers are referenced by the three sources, but the issue/PR does not exist in this repo (a cross-repo reference, a typo, or a reference to a deleted ticket).',
);
out.push('');
if (unresolved.length === 0) {
  out.push('(None.)');
} else {
  out.push('| Ticket number | Referenced by |');
  out.push('|---|---|');
  for (const { num, sources } of unresolved) {
    const src = [...sources.spec.map((s) => `\`${s}\``)];
    if (sources.tests.length > 0) src.push(`test surface ×${sources.tests.length}`);
    if (sources.verify) src.push('`docs/verify/` directory name');
    out.push(`| #${num} | ${src.join('<br>')} |`);
  }
}
out.push('');
out.push('### 3.4 Evidence directories that are not GitHub ticket numbers');
out.push('');
out.push(
  'These directory names under `docs/verify/` are not GitHub ticket numbers of this repo (a historical tracker / thread number / variant directory) and cannot be resolved by `gh issue list`; the evidence itself is in the repo and can be looked up.',
);
out.push('');
if (verifyOther.size === 0) {
  out.push('(None.)');
} else {
  out.push('| Directory | Path |');
  out.push('|---|---|');
  for (const [name, anchor] of verifyOther) {
    out.push(`| ${cell(name)} | \`${anchor}\` |`);
  }
}
out.push('');
out.push(renderEvalCoverage(coverage.rows, repo).trimEnd());
out.push('');

const content = out.join('\n');

// ---------------------------------------------------------------------------
// Write / check
// ---------------------------------------------------------------------------

if (checkOnly) {
  if (!existsSync(DOC_PATH)) fail(`${DOC_REL} does not exist; run without --check to generate it`);
  const onDisk = readFileSync(DOC_PATH, 'utf8');
  if (onDisk !== content) {
    fail(
      `${DOC_REL} differs from a fresh extraction; re-run node scripts/generate-feature-map.mjs and commit the result`,
    );
  }
  process.stdout.write(`${DOC_REL}: up to date with its sources\n`);
} else {
  writeFileSync(DOC_PATH, content);
  process.stdout.write(
    `wrote ${DOC_REL}: ${rows.length} rows (${TIER_ORDER.map((t) => `${t} ${tierCount.get(t)}`).join(' / ')}), [unverified] ${withNone}\n`,
  );
}
