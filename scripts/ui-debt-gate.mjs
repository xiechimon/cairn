#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const WEB_SRC = join(REPO_ROOT, 'apps/web/src');
const BASELINE_PATH = join(REPO_ROOT, 'scripts/ui-debt-baseline.json');
const BASELINE_REL = 'scripts/ui-debt-baseline.json';

const WHITELIST = [
  'styles/app.css',
  'styles/fonts.css',
  'styles/motion.css',
  'styles/shadcn.css',
  'styles/tokens.css',
];

const CONTROL_TAGS = ['button', 'input', 'select', 'textarea'];
const CONTROLS_EXCLUDED_PREFIX = 'components/ui/';

const SPACING_UTILITIES = [
  'p',
  'px',
  'py',
  'pt',
  'pr',
  'pb',
  'pl',
  'ps',
  'pe',
  'm',
  'mx',
  'my',
  'mt',
  'mr',
  'mb',
  'ml',
  'ms',
  'me',
  'gap',
  'gap-x',
  'gap-y',
  'space-x',
  'space-y',
  'w',
  'h',
  'size',
  'min-w',
  'min-h',
  'max-w',
  'max-h',
  'basis',
  'inset',
  'inset-x',
  'inset-y',
  'top',
  'right',
  'bottom',
  'left',
  'start',
  'end',
  'translate-x',
  'translate-y',
  'indent',
];
const ARBITRARY_EXTENSIONS = ['.ts', '.tsx'];
const ARBITRARY_EXCLUDED = (r) =>
  r.startsWith(CONTROLS_EXCLUDED_PREFIX) ||
  /(^|\/)__tests__\//.test(r) ||
  /\.(test|spec)\.tsx?$/.test(r) ||
  r.endsWith('.d.ts');

const LENGTH = String.raw`(?:length:)?-?(?:\d+(?:\.\d*)?|\.\d+)(?:px|rem|em)`;
const INTERPOLATED = String.raw`[^\]\s]*\$\{[^\]]*`;
const utilityAlternation = (names) =>
  [...names]
    .sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/-/g, '\\-'))
    .join('|');
const arbitraryPattern = (names) =>
  new RegExp(
    String.raw`(?<![\w-])-?(?:${utilityAlternation(names)})-\[(?:${LENGTH}|${INTERPOLATED})\]`,
    'g',
  );
const TEXT_PATTERN = arbitraryPattern(['text']);
const SPACING_PATTERN = arbitraryPattern(SPACING_UTILITIES);

function countArbitrary(source) {
  return {
    text: source.match(TEXT_PATTERN)?.length ?? 0,
    spacing: source.match(SPACING_PATTERN)?.length ?? 0,
  };
}

const ARBITRARY_CANARY = [
  ['className="text-[13px]"', 1, 0],
  ['md:text-[13.5px] hover:!text-[12px] text-[11px]!', 3, 0],
  ['text-[0.8rem] text-[.75rem] text-[length:13px] text-[13px]/5', 4, 0],
  [`\`text-[\${size}px]\` \`ml-[\${gap}px]\``, 1, 1],
  ['\r\nml-[10.5px]\r\n-mt-[3px] top-[-1px] max-w-[300px]', 0, 4],
  ['[&>svg]:size-[14px] data-[size=sm]:gap-x-[6px] *:py-[5px]', 0, 3],
  ['// was text-[12px] and h-[49px]', 1, 1],
  ['text-[#fff] text-[var(--x)] text-(--x) text-sm text-ui context-[3px]', 0, 0],
  ['w-[50%] h-[calc(100%-4px)] max-[816px]:flex min-w-[68ch] rounded-[10px]', 0, 0],
  ['leading-[18px] tracking-[0.02em] stop-[3px] blend-[2px] font-size-[3px]', 0, 0],
];

function selfCheckMatcher() {
  const problems = [];
  for (const [sample, text, spacing] of ARBITRARY_CANARY) {
    const got = countArbitrary(sample);
    if (got.text !== text || got.spacing !== spacing) {
      problems.push(
        `matcher canary ${JSON.stringify(sample)}: expected text ${text} / spacing ${spacing}, got ${got.text} / ${got.spacing}`,
      );
    }
  }
  return problems;
}

const rel = (p) => relative(WEB_SRC, p).split(sep).join('/');

function walk(dir, extensions, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, extensions, out);
    else if ([extensions].flat().some((e) => path.endsWith(e))) out.push(path);
  }
  return out;
}

function countLines(text) {
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') n++;
  return n;
}

function tagsOf(source, tag) {
  const open = `<${tag}`;
  const found = [];
  for (let i = source.indexOf(open); i !== -1; i = source.indexOf(open, i + 1)) {
    const next = source[i + open.length];
    if (next !== undefined && /[A-Za-z0-9-]/.test(next)) continue;
    let depth = 0;
    let quote = null;
    let j = i + open.length;
    for (; j < source.length; j++) {
      const c = source[j];
      if (quote) {
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') quote = c;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    found.push(source.slice(i, j));
  }
  return found;
}

function scanTree() {
  const cssFiles = walk(WEB_SRC, '.css');
  const tsxFiles = walk(WEB_SRC, '.tsx');
  const arbitraryFiles = walk(WEB_SRC, ARBITRARY_EXTENSIONS);

  const problems = [];
  if (cssFiles.length === 0) problems.push('scan found no *.css under apps/web/src');
  if (tsxFiles.length === 0) problems.push('scan found no *.tsx under apps/web/src');
  problems.push(...selfCheckMatcher());
  for (const w of WHITELIST) {
    if (!cssFiles.some((f) => rel(f) === w)) {
      problems.push(`whitelisted carrier file missing from tree: ${w}`);
    }
  }
  if (problems.length > 0) {
    for (const p of problems) console.error(`[ui-debt-gate] D4 ${p}`);
    process.exit(2);
  }

  const whitelistSet = new Set(WHITELIST);
  const perFaceCss = {};
  for (const f of cssFiles) {
    const r = rel(f);
    if (whitelistSet.has(r)) continue;
    perFaceCss[r] = countLines(readFileSync(f, 'utf8'));
  }

  const controlFiles = {};
  let controlTotal = 0;
  for (const f of tsxFiles) {
    const r = rel(f);
    if (r.startsWith(CONTROLS_EXCLUDED_PREFIX)) continue;
    const source = readFileSync(f, 'utf8');
    let n = 0;
    for (const tag of CONTROL_TAGS) n += tagsOf(source, tag).length;
    if (n > 0) controlFiles[r] = n;
    controlTotal += n;
  }

  const arbitrary = { textTotal: 0, spacingTotal: 0, files: {} };
  let arbitraryScanned = 0;
  for (const f of arbitraryFiles) {
    const r = rel(f);
    if (ARBITRARY_EXCLUDED(r)) continue;
    arbitraryScanned++;
    const { text, spacing } = countArbitrary(readFileSync(f, 'utf8'));
    if (text + spacing > 0) arbitrary.files[r] = { text, spacing };
    arbitrary.textTotal += text;
    arbitrary.spacingTotal += spacing;
  }

  return {
    perFaceCss,
    controlFiles,
    controlTotal,
    arbitrary,
    cssCount: cssFiles.length,
    tsxCount: tsxFiles.length,
    arbitraryScanned,
  };
}

function sortedObject(obj) {
  const out = {};
  for (const k of Object.keys(obj).sort()) out[k] = obj[k];
  return out;
}

function isNonNegativeInt(v) {
  return Number.isInteger(v) && v >= 0;
}

function validateArbitrary(av, label, { optional }) {
  if (av === undefined && optional) return [];
  if (av === null || typeof av !== 'object')
    return [`${label}: arbitraryValues missing or not an object`];
  const problems = [];
  for (const key of ['textTotal', 'spacingTotal']) {
    if (!isNonNegativeInt(av[key]))
      problems.push(`${label}: arbitraryValues.${key} is not a non-negative integer`);
  }
  if (av.files === null || typeof av.files !== 'object') {
    problems.push(`${label}: arbitraryValues.files missing or not an object`);
    return problems;
  }
  const sum = { text: 0, spacing: 0 };
  for (const [k, v] of Object.entries(av.files)) {
    for (const key of ['text', 'spacing']) {
      if (!isNonNegativeInt(v?.[key]))
        problems.push(
          `${label}: arbitraryValues.files["${k}"].${key} is not a non-negative integer`,
        );
      else sum[key] += v[key];
    }
  }
  if (problems.length === 0) {
    if (sum.text !== av.textTotal)
      problems.push(
        `${label}: arbitraryValues.files text sums to ${sum.text} but textTotal is ${av.textTotal}`,
      );
    if (sum.spacing !== av.spacingTotal)
      problems.push(
        `${label}: arbitraryValues.files spacing sums to ${sum.spacing} but spacingTotal is ${av.spacingTotal}`,
      );
  }
  return problems;
}

function validateBaseline(b, label, { arbitraryOptional = false } = {}) {
  const problems = [];
  if (b === null || typeof b !== 'object') return [`${label}: baseline is not an object`];
  if (b.perFaceCss === null || typeof b.perFaceCss !== 'object') {
    problems.push(`${label}: perFaceCss missing or not an object`);
  } else {
    for (const [k, v] of Object.entries(b.perFaceCss)) {
      if (!isNonNegativeInt(v))
        problems.push(`${label}: perFaceCss["${k}"] is not a non-negative integer`);
    }
  }
  const rc = b.rawControls;
  if (rc === null || typeof rc !== 'object') {
    problems.push(`${label}: rawControls missing or not an object`);
    return problems;
  }
  if (!isNonNegativeInt(rc.total))
    problems.push(`${label}: rawControls.total is not a non-negative integer`);
  if (rc.files === null || typeof rc.files !== 'object') {
    problems.push(`${label}: rawControls.files missing or not an object`);
    return problems;
  }
  let sum = 0;
  for (const [k, v] of Object.entries(rc.files)) {
    if (!isNonNegativeInt(v))
      problems.push(`${label}: rawControls.files["${k}"] is not a non-negative integer`);
    else sum += v;
  }
  if (problems.length === 0 && sum !== rc.total) {
    problems.push(
      `${label}: rawControls.files sums to ${sum} but rawControls.total is ${rc.total}`,
    );
  }
  problems.push(...validateArbitrary(b.arbitraryValues, label, { optional: arbitraryOptional }));
  return problems;
}

function loadInTreeBaseline() {
  if (!existsSync(BASELINE_PATH)) {
    console.error(
      `[ui-debt-gate] D4 no baseline at ${BASELINE_REL} — freeze one from a clean main with: node scripts/ui-debt-gate.mjs --write`,
    );
    process.exit(2);
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  } catch (err) {
    console.error(`[ui-debt-gate] D4 ${BASELINE_REL} is not valid JSON: ${err.message}`);
    process.exit(2);
  }
  const problems = validateBaseline(parsed, BASELINE_REL);
  if (problems.length > 0) {
    for (const p of problems) console.error(`[ui-debt-gate] D4 ${p}`);
    process.exit(2);
  }
  return parsed;
}

function git(args) {
  return execFileSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function loadBaseBaseline(sha) {
  let text;
  try {
    text = git(['show', `${sha}:${BASELINE_REL}`]);
  } catch {
    try {
      git(['rev-parse', '--verify', '--quiet', `${sha}^{commit}`]);
    } catch {
      console.error(
        `[ui-debt-gate] D4 base sha ${sha} is not available locally; fetch it first (CI: git fetch --depth=1 origin <sha>). Refusing to fall back to the branch baseline.`,
      );
      process.exit(2);
    }
    return { baseline: null, mode: 'bootstrap' };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    console.error(`[ui-debt-gate] D4 baseline at base ${sha} is not valid JSON: ${err.message}`);
    process.exit(2);
  }
  const problems = validateBaseline(parsed, `base ${sha.slice(0, 12)}`, {
    arbitraryOptional: true,
  });
  if (problems.length > 0) {
    for (const p of problems) console.error(`[ui-debt-gate] D4 ${p}`);
    process.exit(2);
  }
  return { baseline: parsed, mode: 'base' };
}

function currentSha() {
  try {
    return git(['rev-parse', 'HEAD']).trim();
  } catch {
    return 'unknown';
  }
}

function writeBaseline(scan) {
  const previous = existsSync(BASELINE_PATH)
    ? safeParse(readFileSync(BASELINE_PATH, 'utf8'))
    : null;
  const doc = {
    frozenFrom: { sha: currentSha(), date: new Date().toISOString().slice(0, 10) },
    scope:
      'apps/web/src; per-face css = *.css minus the ui-debt-gate.mjs WHITELIST (carrier layer); bare controls = <button|<input|<select|<textarea occurrences in *.tsx minus components/ui/; arbitrary values = text-[<len>] and SPACING_UTILITIES-[<len>] (px|rem|em, or interpolated) in *.ts/*.tsx minus components/ui/ and test files',
    perFaceCss: sortedObject(scan.perFaceCss),
    rawControls: { total: scan.controlTotal, files: sortedObject(scan.controlFiles) },
    arbitraryValues: {
      textTotal: scan.arbitrary.textTotal,
      spacingTotal: scan.arbitrary.spacingTotal,
      files: sortedObject(scan.arbitrary.files),
    },
  };
  writeFileSync(BASELINE_PATH, `${JSON.stringify(doc, null, 2)}\n`);

  const cssTotal = Object.values(doc.perFaceCss).reduce((a, b) => a + b, 0);
  console.log(
    `[ui-debt-gate] baseline frozen: ${Object.keys(doc.perFaceCss).length} per-face css files / ${cssTotal} lines; ${doc.rawControls.total} bare control(s) in ${Object.keys(doc.rawControls.files).length} file(s); arbitrary values ${doc.arbitraryValues.textTotal} text + ${doc.arbitraryValues.spacingTotal} spacing in ${Object.keys(doc.arbitraryValues.files).length} file(s). Written to ${BASELINE_REL}.`,
  );
  if (previous) {
    const notes = [];
    for (const [file, n] of Object.entries(doc.perFaceCss)) {
      const before = previous.perFaceCss?.[file];
      if (before === undefined) notes.push(`  css +new  ${file}: ${n} lines`);
      else if (n !== before)
        notes.push(`  css ${n > before ? 'UP' : 'down'} ${file}: ${before} -> ${n}`);
    }
    for (const [file, before] of Object.entries(previous.perFaceCss ?? {})) {
      if (doc.perFaceCss[file] === undefined) notes.push(`  css -gone ${file} (was ${before})`);
    }
    const totalBefore = previous.rawControls?.total;
    if (totalBefore !== undefined && totalBefore !== doc.rawControls.total) {
      notes.push(
        `  controls ${doc.rawControls.total > totalBefore ? 'UP' : 'down'} total: ${totalBefore} -> ${doc.rawControls.total}`,
      );
    }
    for (const key of ['textTotal', 'spacingTotal']) {
      const before = previous.arbitraryValues?.[key];
      const now = doc.arbitraryValues[key];
      if (before === undefined) notes.push(`  arbitrary +new ${key}: ${now}`);
      else if (before !== now)
        notes.push(`  arbitrary ${now > before ? 'UP' : 'down'} ${key}: ${before} -> ${now}`);
    }
    if (notes.length > 0) {
      console.log('[ui-debt-gate] delta vs previous baseline:');
      for (const n of notes) console.log(n);
      if (notes.some((n) => n.includes(' UP ') || n.includes('+new'))) {
        console.log(
          '[ui-debt-gate] WARNING: this re-freeze RAISES the ledger. CI (D3) compares against the base baseline, so a raised baseline does not legalize new debt on a PR.',
        );
      }
    } else {
      console.log('[ui-debt-gate] no numeric change vs previous baseline.');
    }
  }
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function check(baseSha) {
  const scan = scanTree();
  const inTree = loadInTreeBaseline();

  let effective = inTree;
  let baseMode = 'in-tree only';
  let arbitraryCeiling = inTree.arbitraryValues;
  let arbitraryMode = '';
  if (baseSha) {
    const loaded = loadBaseBaseline(baseSha);
    if (loaded.mode === 'base') {
      effective = loaded.baseline;
      baseMode = `base ${baseSha.slice(0, 12)}`;
      if (effective.arbitraryValues) arbitraryCeiling = effective.arbitraryValues;
      else
        arbitraryMode = ' (arbitraryValues: bootstrap, base predates the ledger — in-tree numbers)';
    } else {
      baseMode = `bootstrap (base ${baseSha.slice(0, 12)} has no ${BASELINE_REL})`;
    }
  }

  const failures = [];
  const shrunk = [];

  for (const [file, n] of Object.entries(scan.perFaceCss)) {
    const allowed = effective.perFaceCss?.[file] ?? 0;
    if (n > allowed) {
      const isNew = effective.perFaceCss?.[file] === undefined;
      failures.push(
        `D1 ${file}: ${n} lines > baseline ${allowed}${isNew ? ' (new per-face css file — new faces are red, #913 acceptance item 7)' : ''}`,
      );
    } else if (n < allowed) {
      shrunk.push(`css ${file}: ${allowed} -> ${n}`);
    }
  }

  const allowedTotal = effective.rawControls?.total ?? 0;
  if (scan.controlTotal > allowedTotal) {
    const grew = [];
    for (const [file, n] of Object.entries(scan.controlFiles)) {
      const before = effective.rawControls?.files?.[file] ?? 0;
      if (n > before) grew.push(`${file} ${before}->${n}`);
    }
    failures.push(
      `D2 bare controls: ${scan.controlTotal} total > baseline ${allowedTotal}${grew.length > 0 ? ` (grew at: ${grew.join(', ')})` : ''}`,
    );
  } else if (scan.controlTotal < allowedTotal) {
    shrunk.push(`bare controls total: ${allowedTotal} -> ${scan.controlTotal}`);
  }

  for (const [key, label] of [
    ['text', 'arbitrary text sizes (text-[<len>])'],
    ['spacing', 'arbitrary spacing/size (SPACING_UTILITIES-[<len>])'],
  ]) {
    const now = scan.arbitrary[`${key}Total`];
    const allowed = arbitraryCeiling[`${key}Total`];
    if (now > allowed) {
      const grew = [];
      for (const [file, counts] of Object.entries(scan.arbitrary.files)) {
        const before = arbitraryCeiling.files?.[file]?.[key] ?? 0;
        if (counts[key] > before) grew.push(`${file} ${before}->${counts[key]}`);
      }
      failures.push(
        `D5 ${label}: ${now} total > baseline ${allowed}${grew.length > 0 ? ` (grew at: ${grew.join(', ')})` : ''} — use the DESIGN.md scale (text-page/heading/card-title/ui/meta/caption, 4px-grid spacing) instead of an arbitrary value`,
      );
    } else if (now < allowed) {
      shrunk.push(`arbitrary ${key} total: ${allowed} -> ${now}`);
    }
  }

  if (baseSha && effective !== inTree) {
    for (const [file, n] of Object.entries(inTree.perFaceCss)) {
      const before = effective.perFaceCss?.[file] ?? 0;
      if (n > before) {
        failures.push(`D3 ${BASELINE_REL} perFaceCss["${file}"] raised vs base: ${before} -> ${n}`);
      }
    }
    const totalNow = inTree.rawControls.total;
    const totalBefore = effective.rawControls?.total ?? 0;
    if (totalNow > totalBefore) {
      failures.push(
        `D3 ${BASELINE_REL} rawControls.total raised vs base: ${totalBefore} -> ${totalNow}`,
      );
    }
    if (effective.arbitraryValues) {
      for (const key of ['textTotal', 'spacingTotal']) {
        const now = inTree.arbitraryValues[key];
        const before = effective.arbitraryValues[key];
        if (now > before) {
          failures.push(
            `D3 ${BASELINE_REL} arbitraryValues.${key} raised vs base: ${before} -> ${now}`,
          );
        }
      }
    }
  }

  if (failures.length > 0) {
    for (const f of failures) console.log(`[ui-debt-gate] ${f}`);
    console.log(
      `[ui-debt-gate] FAIL: ${failures.length} violation(s). Build with components/ui/* + Tailwind theme keys; per-face css, bare controls and arbitrary values may only shrink. After removing debt, re-freeze: node scripts/ui-debt-gate.mjs --write`,
    );
    process.exit(1);
  }

  if (shrunk.length > 0) {
    console.log('[ui-debt-gate] debt below baseline (ratchet it down in this PR):');
    for (const s of shrunk) console.log(`  ${s}`);
    console.log('  run: node scripts/ui-debt-gate.mjs --write');
  }
  const cssTotal = Object.values(scan.perFaceCss).reduce((a, b) => a + b, 0);
  console.log(
    `[ui-debt-gate] PASS: ${Object.keys(scan.perFaceCss).length} per-face css files / ${cssTotal} lines; ${scan.controlTotal} bare control(s) in ${Object.keys(scan.controlFiles).length} file(s); arbitrary values ${scan.arbitrary.textTotal} text + ${scan.arbitrary.spacingTotal} spacing in ${Object.keys(scan.arbitrary.files).length} file(s); ${scan.cssCount} css + ${scan.tsxCount} tsx + ${scan.arbitraryScanned} ts/tsx (arbitrary scope) scanned. Baseline: ${baseMode}${arbitraryMode}, frozen from ${(effective.frozenFrom?.sha ?? 'unknown').slice(0, 12)}.`,
  );
  process.exit(0);
}

const argv = process.argv.slice(2);
let writeMode = false;
let baseSha = process.env.UI_DEBT_BASE_SHA || '';
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '--write') writeMode = true;
  else if (arg === '--base') {
    baseSha = argv[++i] ?? '';
    if (!baseSha) {
      console.error('[ui-debt-gate] --base requires a sha argument');
      process.exit(2);
    }
  } else {
    console.error(`[ui-debt-gate] unknown argument: ${arg} (expected --write or --base <sha>)`);
    process.exit(2);
  }
}

if (writeMode) {
  writeBaseline(scanTree());
} else {
  check(baseSha);
}
