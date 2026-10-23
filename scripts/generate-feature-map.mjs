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

// Tier vocabulary and semantics: docs/spec/18-定位与差异化.md (差异化面 = the
// three semantic-axis cores — two hard gates, AI review with teeth, versioned
// plan documents; 运行轴 = the runtime model — machine × CLI, daemon,
// self-hosted orchestration; 通用面 = everything else). Classification is a
// title keyword match, first rule wins, not a semantic judgment — §0.6 of the
// doc states this limitation.
const TIER_ORDER = ['差异化面', '运行轴', '通用面'];
const TIER_RULES = [
  ['差异化面', /闸|gate|confirm|review|审核|方案|plan|驳回|reject|revision|verdict|相位|phase/i],
  [
    '运行轴',
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
  const numeric = new Set();
  const other = [];
  if (!existsSync(dir)) return { numeric, other };
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (/^\d+$/.test(entry.name)) numeric.add(String(Number(entry.name)));
    else other.push(entry.name);
  }
  return { numeric, other: other.sort() };
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
  return '通用面';
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

const specRefs = collectSpecRefs();
const { numeric: verifyNumeric, other: verifyOther } = collectVerifyDirs();
const { refs: testRefs, fileCount: testFileCount } = collectTestRefs();
const { repo, tickets } = fetchTickets();
const ciJobs = collectCiSurface();

const union = [...new Set([...specRefs.keys(), ...verifyNumeric, ...testRefs.keys()])];

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
  if (verifyNumeric.has(num)) anchors.push(`docs/verify/${num}/`);
  anchors.push(...sources.tests);
  const anchored = anchors.length > 0;
  const status =
    rec.state === 'closed' ? (anchored ? '已做' : '未验证') : anchored ? '在跑' : '待开';
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
out.push('# 功能地图（当前状态活册）');
out.push('');
out.push(
  '> 本册由 `scripts/generate-feature-map.mjs` 机械抽取生成，勿手改；改口径 = 改脚本后重跑（#894 立首版规则）。',
);
out.push(
  '> 重生成：`node scripts/generate-feature-map.mjs`；校验落盘版与源数据一致：加 `--check`。',
);
out.push('> 前置：`gh` 已登录、api.github.com 可达。');
out.push('> 与 03 册分工：03-ROADMAP = 构建顺序历史册；本册 = 当前状态活册。');
out.push(
  '> 编号注：曾落 spec 序列 22 号，撞号重编至 25（#952）；#1527 起移出编号序列，改落 `docs/feature-map.md`（生成物不占手写册号）。',
);
out.push('');
out.push('## 0. 抽取口径');
out.push('');
out.push('全部规则机械可重跑，无逐行人工编辑。正本 = 脚本本身，本节由脚本渲染。');
out.push('');
out.push('### 0.1 行与列');
out.push('');
out.push('行 = 票号并集（三个来源，票号按数值归一、前导零去除）：');
out.push('');
out.push(`1. \`docs/spec/*.md\` 里的 \`${REF_SOURCE}\` 引用——负向前瞻排除十六进制色值；`);
out.push('2. `docs/verify/` 的纯数字目录名（已落地验收产物）；');
out.push(
  `3. CI 测试面（${TEST_ROOTS.join('、')} 下的 ${TEST_SUFFIXES.join(' / ')}，跳过 ${[...TEST_SKIP_DIRS].sort().join('、')}）里的票号引用。`,
);
out.push('');
out.push(
  '标题与状态取 `gh api repos/<owner>/<repo>/issues?state=all`（含 PR）。行集按 `gh issue list` 口径只收 issue；被引用的 PR 号不生成行（列 §3.2），解析不到的票号列 §3.3。',
);
out.push('');
out.push('四列：功能 = `#票号` + issue 标题逐字；哪一档 = §0.2；状态 = §0.3；验证锚 = §0.4。');
out.push('');
out.push('### 0.2 档位规则（18 册口径）');
out.push('');
out.push('档位词表来自 `docs/spec/18-定位与差异化.md`（差异化面 / 运行轴 / 通用面）。');
out.push('判定 = 标题关键词匹配，按下表顺序首中即停，全不中 = 通用面：');
out.push('');
out.push('| 档 | 标题正则（脚本内正本） |');
out.push('|---|---|');
for (const [tier, re] of TIER_RULES) {
  out.push(`| ${tier} | \`/${re.source}/${re.flags}\` |`);
}
out.push('');
out.push('### 0.3 状态规则');
out.push('');
out.push('| issue 状态 | 有验证锚 | 无验证锚 |');
out.push('|---|---|---|');
out.push('| closed | 已做 | 未验证 |');
out.push('| open | 在跑 | 待开 |');
out.push('');
out.push('### 0.4 验证锚规则');
out.push('');
out.push('- `docs/verify/<票号>/` 目录存在 → 该路径入锚；');
out.push('- CI 测试面里引用该票号的文件 → 逐个路径入锚（这些文件由 §0.5 的 CI job 执行）；');
out.push('- 两者皆无 → 锚列标 `[未验证]`，行进 §3.1 补活清单。');
out.push('');
out.push('### 0.5 CI 执行面（`.github/workflows/ci.yml` 抽取）');
out.push('');
if (ciJobs.length > 0) {
  out.push('| job | 命名步骤 |');
  out.push('|---|---|');
  for (const job of ciJobs) {
    out.push(`| \`${job.id}\` | ${job.steps.map((s) => cell(s)).join('、')} |`);
  }
} else {
  out.push('（未找到 `.github/workflows/ci.yml`。）');
}
out.push('');
out.push('### 0.6 已知局限（首版如实登记）');
out.push('');
out.push('1. 引用识别是行级正则，不排代码围栏：spec 代码块里的 `#NNN` 也会被当引用收进。');
out.push(
  '2. 档位是标题关键词匹配，不做语义判断——多义词不区分（「闸」既是产品硬闸也是 CI 闸名，「review」既是 AI 审核也是一般代码审查）。错档行 = 规则噪音，细化 §0.2 两条正则是后续活。',
);
out.push('3. 状态不读 `state_reason`：wontfix / not_planned 关闭的票同样记「已做」。');
out.push('4. 功能列 = issue 标题逐字。开票后行为再演化，标题不跟。');
out.push(
  '5. 行集 = 三源引用到的票。从未开票、或开了票但 spec / 测试 / 证据都没引用过的功能不在册。',
);
out.push(
  '6. GitHub 数据是生成时点快照；源数据变了重跑即更新（活册的更新方式）。「跑两次一致」指源数据不变时字节一致。',
);
out.push('');

// §1 statistics
const tierCount = new Map(TIER_ORDER.map((t) => [t, 0]));
const statusCount = new Map([
  ['已做', 0],
  ['在跑', 0],
  ['待开', 0],
  ['未验证', 0],
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

out.push('## 1. 统计');
out.push('');
out.push('| 项 | 数 |');
out.push('|---|---|');
out.push(`| 地图行（issue） | ${rows.length} |`);
for (const tier of TIER_ORDER) {
  out.push(`| 其中 ${tier} | ${tierCount.get(tier)} |`);
}
for (const status of ['已做', '在跑', '待开', '未验证']) {
  out.push(`| 状态 ${status} | ${statusCount.get(status)} |`);
}
out.push(`| 锚 = 证据目录 + 测试引用 | ${withBoth} |`);
out.push(`| 锚 = 仅证据目录 | ${withVerify} |`);
out.push(`| 锚 = 仅测试引用 | ${withTests} |`);
out.push(`| 无锚（\`[未验证]\`） | ${withNone} |`);
out.push(`| 被引用的 PR（不生成行，§3.2） | ${prRefs.length} |`);
out.push(`| 解析不到的票号（§3.3） | ${unresolved.length} |`);
out.push(`| 非 GitHub 票号的证据目录（§3.4） | ${verifyOther.length} |`);
out.push(`| 扫描面：spec 册 / 测试文件 | ${specFileCount} / ${testFileCount} |`);
out.push('');

// §2 the map
out.push('## 2. 功能地图');
out.push('');
out.push(`排序：档位（${TIER_ORDER.join(' → ')}）内按票号升序。`);
out.push('');
out.push('| 功能 | 哪一档 | 状态 | 验证锚 |');
out.push('|---|---|---|---|');
for (const row of rows) {
  const feature = `[#${row.num}](${issueUrl(repo, row.num)}) ${cell(row.title)}`;
  const anchor = row.anchored ? row.anchors.map((a) => `\`${a}\``).join('<br>') : '[未验证]';
  out.push(`| ${feature} | ${row.tier} | ${row.status} | ${anchor} |`);
}
out.push('');

// §3 gaps
out.push('## 3. 没锚与挂不上的行（后续要补的活）');
out.push('');
out.push('### 3.1 `[未验证]` 行');
out.push('');
out.push(
  '这些行没有 `docs/verify/<票号>/` 目录，CI 测试面也没有文件引用该票号——功能声称来自 spec 册，但没有可指过去的验证锚。补锚 = 补 verify 证据或补测试引用。',
);
out.push('');
const unverified = rows.filter((r) => !r.anchored);
if (unverified.length === 0) {
  out.push('（无。）');
} else {
  out.push('| 票 | 功能 | 引用它的 spec 册 |');
  out.push('|---|---|---|');
  for (const row of unverified) {
    out.push(
      `| [#${row.num}](${issueUrl(repo, row.num)}) | ${cell(row.title)} | ${row.sources.spec.map((s) => `\`${s}\``).join('<br>')} |`,
    );
  }
}
out.push('');
out.push('### 3.2 被引用的 PR（不生成行）');
out.push('');
out.push('行集口径 = issue（§0.1）。这些 PR 号被三源引用到，实现在对应 issue 行下。');
out.push('');
if (prRefs.length === 0) {
  out.push('（无。）');
} else {
  out.push('| PR | 标题 | 状态 | 引用来源 |');
  out.push('|---|---|---|---|');
  for (const { num, rec, sources } of prRefs) {
    const src = [];
    if (sources.spec.length > 0) src.push(`spec ×${sources.spec.length}`);
    if (sources.tests.length > 0) src.push(`测试 ×${sources.tests.length}`);
    out.push(
      `| [#${num}](https://github.com/${repo}/pull/${num}) | ${cell(rec.title)} | ${rec.state === 'closed' ? 'closed' : 'open'} | ${src.join('、')} |`,
    );
  }
}
out.push('');
out.push('### 3.3 解析不到的票号');
out.push('');
out.push('这些号被三源引用到，但仓内不存在该 issue/PR（跨仓引用、笔误，或引用了被删除的票）。');
out.push('');
if (unresolved.length === 0) {
  out.push('（无。）');
} else {
  out.push('| 票号 | 引用来源 |');
  out.push('|---|---|');
  for (const { num, sources } of unresolved) {
    const src = [...sources.spec.map((s) => `\`${s}\``)];
    if (sources.tests.length > 0) src.push(`测试面 ×${sources.tests.length}`);
    if (sources.verify) src.push('`docs/verify/` 目录名');
    out.push(`| #${num} | ${src.join('<br>')} |`);
  }
}
out.push('');
out.push('### 3.4 非 GitHub 票号的证据目录');
out.push('');
out.push(
  '`docs/verify/` 下这些目录名不是本仓 GitHub 票号（历史 tracker / 线程编号 / 变体目录），`gh issue list` 解析不到；证据本体在仓内可查。',
);
out.push('');
if (verifyOther.length === 0) {
  out.push('（无。）');
} else {
  out.push('| 目录 | 路径 |');
  out.push('|---|---|');
  for (const name of verifyOther) {
    out.push(`| ${cell(name)} | \`docs/verify/${name}/\` |`);
  }
}
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
    `wrote ${DOC_REL}: ${rows.length} rows (${TIER_ORDER.map((t) => `${t} ${tierCount.get(t)}`).join(' / ')}), [未验证] ${withNone}\n`,
  );
}
