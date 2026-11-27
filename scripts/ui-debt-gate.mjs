#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const WEB_SRC = join(REPO_ROOT, 'apps/web/src');
const BASELINE_PATH = join(REPO_ROOT, 'scripts/ui-debt-baseline.json');
const BASELINE_REL = 'scripts/ui-debt-baseline.json';

const WHITELIST = ['styles/app.css', 'styles/fonts.css', 'styles/motion.css', 'styles/shadcn.css'];

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
    .map((n) => n.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&'))
    .join('|');
const arbitraryPattern = (names) =>
  new RegExp(
    String.raw`(?<![\w-])-?(?:${utilityAlternation(names)})-\[(?:${LENGTH}|${INTERPOLATED})\]`,
    'g',
  );
const TEXT_PATTERN = arbitraryPattern(['text']);
const RADIUS_PATTERN = new RegExp(
  String.raw`(?<![\w-])rounded(?:-(?:t|r|b|l|s|e|tl|tr|br|bl|ss|se|es|ee))?-\[(?:${LENGTH}|${INTERPOLATED})\]`,
  'g',
);
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

const RADIUS_CANARY = [
  ['rounded-[4px] rounded-br-[6px] hover:rounded-[0.5rem]', 3],
  ['rounded-(--cds-radius-sm) rounded-[min(var(--radius-md),10px)] rounded-lg', 0],
];

const HELPER_PROP_TAGS = {
  SettingsRow: ['hint', 'status', 'info'],
  SettingsSection: ['description', 'info'],
  FormField: ['help'],
  FormActions: ['hint'],
  DialogShell: ['subtitle', 'info', 'hint'],
  AlertDialogShell: ['subtitle', 'hint'],
  DialogFootRow: ['hint'],
};
const HELPER_TAGS = [
  'FieldDescription',
  'FormDescription',
  'DialogDescription',
  'AlertDialogDescription',
  'InfoTip',
];

const HELPER_CANARY = [
  ['<SettingsRow hint="copy" info={tip} />', 2],
  ['<SettingsRow hint={null} info={undefined} />', 0],
  ['<SettingsSection description="copy" info={null} />', 1],
  ['<FormField help={condition ? "copy" : undefined} />', 1],
  ['<FormActions hint={<span>copy</span>} />', 1],
  ['<DialogShell subtitle="copy" hint={false} />', 1],
  ['<FieldDescription>copy</FieldDescription><InfoTip info={tip} />', 2],
  ['<span className={cn(SETTINGS_HINT_CLS, extra)}>copy</span>', 1],
  ['const sample = `<FormField help="inside a string" />`;', 0],
];

const DISABLED_CANARY = [
  ['<Button disabled>Save</Button>', 1],
  ['<DialogShell footer={<Button disabled>Save</Button>} />', 1],
  ['<Button disabled={true}>Save</Button>', 1],
  ['<Button disabled={busy}>Save</Button><Input disabled={busy || saving} />', 0],
  ['const action = { disabled: true };', 1],
  ['const action = { disabled: busy };', 0],
  ['type Props = { disabled?: boolean }; const defaults = { disabled: false };', 0],
  ['const sample = `<Button disabled>inside a string</Button>`;', 0],
];

function selfCheckMatcher() {
  const problems = [];
  for (const [sample, want] of RADIUS_CANARY) {
    const got = sample.match(RADIUS_PATTERN)?.length ?? 0;
    if (got !== want) {
      problems.push(`radius canary ${JSON.stringify(sample)}: expected ${want}, got ${got}`);
    }
  }
  for (const [sample, text, spacing] of ARBITRARY_CANARY) {
    const got = countArbitrary(sample);
    if (got.text !== text || got.spacing !== spacing) {
      problems.push(
        `matcher canary ${JSON.stringify(sample)}: expected text ${text} / spacing ${spacing}, got ${got.text} / ${got.spacing}`,
      );
    }
  }
  for (const [sample, want] of HELPER_CANARY) {
    const got = countHelperText(sample);
    if (got !== want) {
      problems.push(`helper-text canary ${JSON.stringify(sample)}: expected ${want}, got ${got}`);
    }
  }
  for (const [sample, want] of DISABLED_CANARY) {
    const got = countPermanentlyDisabled(sample);
    if (got !== want) {
      problems.push(
        `permanently-disabled canary ${JSON.stringify(sample)}: expected ${want}, got ${got}`,
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

function openingTagEnd(source, start) {
  let depth = 0;
  let quote = null;
  for (let j = start; j < source.length; j++) {
    const c = source[j];
    if (quote) {
      if (c === '\\') j++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return j;
  }
  return source.length;
}

function tagsOf(source, tag) {
  const open = `<${tag}`;
  const found = [];
  for (let i = source.indexOf(open); i !== -1; i = source.indexOf(open, i + 1)) {
    const next = source[i + open.length];
    if (next !== undefined && /[A-Za-z0-9-]/.test(next)) continue;
    found.push(source.slice(i, openingTagEnd(source, i + open.length)));
  }
  return found;
}

function maskNoise(source) {
  const chars = [...source];
  let state = null;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const next = chars[i + 1];
    if (state === 'line') {
      if (c === '\n') state = null;
      else chars[i] = ' ';
      continue;
    }
    if (state === 'block') {
      if (c === '*' && next === '/') {
        chars[i] = chars[i + 1] = ' ';
        i++;
        state = null;
      } else if (c !== '\n') chars[i] = ' ';
      continue;
    }
    if (state !== null) {
      if (c === '\\') {
        chars[i] = ' ';
        if (next !== '\n' && next !== undefined) chars[i + 1] = ' ';
        i++;
      } else if (c === state) state = null;
      else if (c !== '\n') chars[i] = ' ';
      continue;
    }
    if (c === '/' && next === '/') {
      chars[i] = chars[i + 1] = ' ';
      i++;
      state = 'line';
    } else if (c === '/' && next === '*') {
      chars[i] = chars[i + 1] = ' ';
      i++;
      state = 'block';
    } else if (c === '"' || c === "'" || c === '`') {
      state = c;
    }
  }
  return chars.join('');
}

function curlyEnd(source, start) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return source.length;
}

function jsxAttributes(tagText) {
  const attributes = [];
  const tagName = /^<([A-Za-z][\w.]*)/.exec(tagText);
  let i = tagName?.[0].length ?? 1;
  while (i < tagText.length) {
    const c = tagText[i];
    if (!/[A-Za-z_$]/.test(c)) {
      i++;
      continue;
    }
    let end = i + 1;
    while (end < tagText.length && /[\w$-]/.test(tagText[end])) end++;
    const name = tagText.slice(i, end);
    let j = end;
    while (/\s/.test(tagText[j] ?? '')) j++;
    let value = { kind: 'bare', expression: null };
    if (tagText[j] === '=') {
      j++;
      while (/\s/.test(tagText[j] ?? '')) j++;
      if (tagText[j] === '{') {
        const close = curlyEnd(tagText, j);
        value = { kind: 'expression', expression: tagText.slice(j + 1, close - 1).trim() };
        j = close;
      } else if (tagText[j] === '"' || tagText[j] === "'" || tagText[j] === '`') {
        const quote = tagText[j];
        j++;
        while (j < tagText.length && tagText[j] !== quote) {
          if (tagText[j] === '\\') j++;
          j++;
        }
        value = { kind: 'literal', expression: null };
        j++;
      } else {
        while (j < tagText.length && !/[\s>]/.test(tagText[j])) j++;
        value = { kind: 'literal', expression: null };
      }
    }
    attributes.push({ name, ...value });
    i = Math.max(j, end + 1);
  }
  return attributes;
}

function countsAsHelper(attribute) {
  if (attribute === undefined) return false;
  if (attribute.kind !== 'expression') return true;
  return !['null', 'undefined', 'false'].includes(attribute.expression);
}

function countHelperText(rawSource) {
  const source = maskNoise(rawSource);
  let total = 0;
  for (const [tag, names] of Object.entries(HELPER_PROP_TAGS)) {
    for (const opening of tagsOf(source, tag)) {
      const attributes = jsxAttributes(opening);
      for (const name of names) {
        if (countsAsHelper(attributes.find((attribute) => attribute.name === name))) total++;
      }
    }
  }
  for (const tag of HELPER_TAGS) total += tagsOf(source, tag).length;
  total += source.match(/className=\{[^}]*SETTINGS_HINT_CLS/g)?.length ?? 0;
  return total;
}

function allJsxOpeningTags(source) {
  const found = [];
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== '<' || !/[A-Za-z]/.test(source[i + 1] ?? '')) continue;
    let end = i + 1;
    while (end < source.length && /[\w.]/.test(source[end])) end++;
    const close = openingTagEnd(source, end);
    found.push({ tag: source.slice(i + 1, end), text: source.slice(i, close) });
  }
  return found;
}

function countPermanentlyDisabled(rawSource) {
  const source = maskNoise(rawSource);
  let total = 0;
  for (const opening of allJsxOpeningTags(source)) {
    const disabled = jsxAttributes(opening.text).find((attribute) => attribute.name === 'disabled');
    if (disabled?.kind === 'bare') total++;
    else if (disabled?.kind === 'expression' && disabled.expression === 'true') total++;
  }
  total += source.match(/(?<![\w$])disabled\s*:\s*true\b/g)?.length ?? 0;
  return total;
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
  const helperText = { total: 0, files: {} };
  const permanentlyDisabledControls = { total: 0, files: {} };
  const radii = [];
  let arbitraryScanned = 0;
  for (const f of arbitraryFiles) {
    const r = rel(f);
    if (ARBITRARY_EXCLUDED(r)) continue;
    arbitraryScanned++;
    const source = readFileSync(f, 'utf8');
    for (const m of source.match(RADIUS_PATTERN) ?? []) radii.push(`${r}: ${m}`);
    const { text, spacing } = countArbitrary(source);
    if (text + spacing > 0) arbitrary.files[r] = { text, spacing };
    arbitrary.textTotal += text;
    arbitrary.spacingTotal += spacing;
    const helpers = countHelperText(source);
    if (helpers > 0) helperText.files[r] = helpers;
    helperText.total += helpers;
    const disabled = countPermanentlyDisabled(source);
    if (disabled > 0) permanentlyDisabledControls.files[r] = disabled;
    permanentlyDisabledControls.total += disabled;
  }

  return {
    perFaceCss,
    controlFiles,
    controlTotal,
    arbitrary,
    helperText,
    permanentlyDisabledControls,
    radii,
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

function validateCountLedger(value, label, name, { optional = false } = {}) {
  if (value === undefined && optional) return [];
  if (value === null || typeof value !== 'object')
    return [`${label}: ${name} missing or not an object`];
  const problems = [];
  if (!isNonNegativeInt(value.total))
    problems.push(`${label}: ${name}.total is not a non-negative integer`);
  if (value.files === null || typeof value.files !== 'object') {
    problems.push(`${label}: ${name}.files missing or not an object`);
    return problems;
  }
  let sum = 0;
  for (const [file, count] of Object.entries(value.files)) {
    if (!isNonNegativeInt(count))
      problems.push(`${label}: ${name}.files["${file}"] is not a non-negative integer`);
    else sum += count;
  }
  if (problems.length === 0 && sum !== value.total) {
    problems.push(`${label}: ${name}.files sums to ${sum} but ${name}.total is ${value.total}`);
  }
  return problems;
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

function validateBaseline(b, label, { arbitraryOptional = false, clutterOptional = false } = {}) {
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
  problems.push(
    ...validateCountLedger(b.helperText, label, 'helperText', { optional: clutterOptional }),
  );
  problems.push(
    ...validateCountLedger(b.permanentlyDisabledControls, label, 'permanentlyDisabledControls', {
      optional: clutterOptional,
    }),
  );
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
    clutterOptional: true,
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

function raisesOverBase(scan, base) {
  const raises = [];
  for (const [file, n] of Object.entries(scan.perFaceCss)) {
    const before = base.perFaceCss?.[file] ?? 0;
    if (n > before) raises.push(`per-face css ${file}: ${before} -> ${n}`);
  }
  const controlsBefore = base.rawControls?.total ?? 0;
  if (scan.controlTotal > controlsBefore) {
    const grew = Object.entries(scan.controlFiles)
      .filter(([file, n]) => n > (base.rawControls?.files?.[file] ?? 0))
      .map(([file]) => file);
    raises.push(`bare controls: ${controlsBefore} -> ${scan.controlTotal} (${grew.join(', ')})`);
  }
  if (base.arbitraryValues) {
    for (const key of ['text', 'spacing']) {
      const before = base.arbitraryValues[`${key}Total`];
      const now = scan.arbitrary[`${key}Total`];
      if (now > before) {
        const grew = Object.entries(scan.arbitrary.files)
          .filter(
            ([file, counts]) => counts[key] > (base.arbitraryValues.files?.[file]?.[key] ?? 0),
          )
          .map(([file]) => file);
        raises.push(`arbitrary ${key}: ${before} -> ${now} (${grew.join(', ')})`);
      }
    }
  }
  for (const [key, label] of [
    ['helperText', 'helper text'],
    ['permanentlyDisabledControls', 'permanently disabled controls'],
  ]) {
    if (!base[key]) continue;
    const before = base[key].total;
    const now = scan[key].total;
    if (now > before) {
      const grew = Object.entries(scan[key].files)
        .filter(([file, count]) => count > (base[key].files?.[file] ?? 0))
        .map(([file]) => file);
      raises.push(`${label}: ${before} -> ${now} (${grew.join(', ')})`);
    }
  }
  return raises;
}

function writeBaseline(scan, baseSha) {
  if (baseSha) {
    const loaded = loadBaseBaseline(baseSha);
    if (loaded.mode === 'base') {
      const raises = raisesOverBase(scan, loaded.baseline);
      if (raises.length > 0) {
        for (const r of raises)
          console.error(
            `[ui-debt-gate] D3 refusing to raise vs base ${baseSha.slice(0, 12)}: ${r}`,
          );
        console.error(
          '[ui-debt-gate] FAIL: the ledger may only shrink. Remove the new debt in the files listed above, then re-run --write; on a merge conflict, take the base side of the baseline first.',
        );
        process.exit(1);
      }
    }
  }
  const previous = existsSync(BASELINE_PATH)
    ? safeParse(readFileSync(BASELINE_PATH, 'utf8'))
    : null;
  const doc = {
    frozenFrom: { sha: currentSha(), date: new Date().toISOString().slice(0, 10) },
    scope:
      'apps/web/src; per-face css = *.css minus the ui-debt-gate.mjs WHITELIST (carrier layer); bare controls = <button|<input|<select|<textarea occurrences in *.tsx minus components/ui/; arbitrary values = text-[<len>] and SPACING_UTILITIES-[<len>] (px|rem|em, or interpolated) in *.ts/*.tsx minus components/ui/ and test files; helperText = helper-producing settings/form/dialog props, description/info-tip nodes and SETTINGS_HINT_CLS uses in the same scope; permanentlyDisabledControls = static disabled or disabled={true} JSX attributes plus disabled: true action config in the same scope',
    perFaceCss: sortedObject(scan.perFaceCss),
    rawControls: { total: scan.controlTotal, files: sortedObject(scan.controlFiles) },
    arbitraryValues: {
      textTotal: scan.arbitrary.textTotal,
      spacingTotal: scan.arbitrary.spacingTotal,
      files: sortedObject(scan.arbitrary.files),
    },
    helperText: { total: scan.helperText.total, files: sortedObject(scan.helperText.files) },
    permanentlyDisabledControls: {
      total: scan.permanentlyDisabledControls.total,
      files: sortedObject(scan.permanentlyDisabledControls.files),
    },
  };
  writeFileSync(BASELINE_PATH, `${JSON.stringify(doc, null, 2)}\n`);

  const cssTotal = Object.values(doc.perFaceCss).reduce((a, b) => a + b, 0);
  console.log(
    `[ui-debt-gate] baseline frozen: ${Object.keys(doc.perFaceCss).length} per-face css files / ${cssTotal} lines; ${doc.rawControls.total} bare control(s) in ${Object.keys(doc.rawControls.files).length} file(s); arbitrary values ${doc.arbitraryValues.textTotal} text + ${doc.arbitraryValues.spacingTotal} spacing in ${Object.keys(doc.arbitraryValues.files).length} file(s); helper text ${doc.helperText.total} in ${Object.keys(doc.helperText.files).length} file(s); permanently disabled controls ${doc.permanentlyDisabledControls.total} in ${Object.keys(doc.permanentlyDisabledControls.files).length} file(s). Written to ${BASELINE_REL}.`,
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
    for (const [key, label] of [
      ['helperText', 'helper text'],
      ['permanentlyDisabledControls', 'permanently disabled controls'],
    ]) {
      const before = previous[key]?.total;
      const now = doc[key].total;
      if (before === undefined) notes.push(`  ${label} +new total: ${now}`);
      else if (before !== now)
        notes.push(`  ${label} ${now > before ? 'UP' : 'down'} total: ${before} -> ${now}`);
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
  const clutterCeilings = {
    helperText: inTree.helperText,
    permanentlyDisabledControls: inTree.permanentlyDisabledControls,
  };
  const clutterBootstrap = [];
  if (baseSha) {
    const loaded = loadBaseBaseline(baseSha);
    if (loaded.mode === 'base') {
      effective = loaded.baseline;
      baseMode = `base ${baseSha.slice(0, 12)}`;
      if (effective.arbitraryValues) arbitraryCeiling = effective.arbitraryValues;
      else
        arbitraryMode = ' (arbitraryValues: bootstrap, base predates the ledger — in-tree numbers)';
      for (const key of Object.keys(clutterCeilings)) {
        if (effective[key]) clutterCeilings[key] = effective[key];
        else clutterBootstrap.push(key);
      }
    } else {
      baseMode = `bootstrap (base ${baseSha.slice(0, 12)} has no ${BASELINE_REL})`;
    }
  }
  const clutterMode =
    clutterBootstrap.length === 0
      ? ''
      : ` (${clutterBootstrap.join(', ')}: bootstrap, base predates the ledger — in-tree numbers)`;

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

  for (const [key, label, code, advice] of [
    [
      'helperText',
      'helper-text nodes',
      'D7',
      'remove explanatory copy or merge it into the control label; helper text may only shrink',
    ],
    [
      'permanentlyDisabledControls',
      'permanently disabled controls',
      'D8',
      'do not render controls the user can never use; show the state or make the action available',
    ],
  ]) {
    const now = scan[key].total;
    const ceiling = clutterCeilings[key];
    const allowed = ceiling.total;
    if (now > allowed) {
      const grew = [];
      for (const [file, count] of Object.entries(scan[key].files)) {
        const before = ceiling.files?.[file] ?? 0;
        if (count > before) grew.push(`${file} ${before}->${count}`);
      }
      failures.push(
        `${code} ${label}: ${now} total > baseline ${allowed}${grew.length > 0 ? ` (grew at: ${grew.join(', ')})` : ''} — ${advice}`,
      );
    } else if (now < allowed) {
      shrunk.push(`${label} total: ${allowed} -> ${now}`);
    }
  }

  for (const hit of scan.radii) {
    failures.push(
      `D6 ${hit}: arbitrary radius. Use a radius token (--cds-radius-xs..2xl, --radius-menu-item, --radius-popover, --radius-card) so nested corners stay concentric`,
    );
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
    for (const key of ['helperText', 'permanentlyDisabledControls']) {
      if (!effective[key]) continue;
      const now = inTree[key].total;
      const before = effective[key].total;
      if (now > before) {
        failures.push(`D3 ${BASELINE_REL} ${key}.total raised vs base: ${before} -> ${now}`);
      }
    }
  }

  if (failures.length > 0) {
    for (const f of failures) console.log(`[ui-debt-gate] ${f}`);
    console.log(
      `[ui-debt-gate] FAIL: ${failures.length} violation(s). Build with components/ui/* + Tailwind theme keys; per-face css, bare controls, arbitrary values, helper text and permanently disabled controls may only shrink. After removing debt, re-freeze: node scripts/ui-debt-gate.mjs --write`,
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
    `[ui-debt-gate] PASS: ${Object.keys(scan.perFaceCss).length} per-face css files / ${cssTotal} lines; ${scan.controlTotal} bare control(s) in ${Object.keys(scan.controlFiles).length} file(s); arbitrary values ${scan.arbitrary.textTotal} text + ${scan.arbitrary.spacingTotal} spacing in ${Object.keys(scan.arbitrary.files).length} file(s); helper text ${scan.helperText.total} in ${Object.keys(scan.helperText.files).length} file(s); permanently disabled controls ${scan.permanentlyDisabledControls.total} in ${Object.keys(scan.permanentlyDisabledControls.files).length} file(s); ${scan.cssCount} css + ${scan.tsxCount} tsx + ${scan.arbitraryScanned} ts/tsx (arbitrary/helper/disabled scope) scanned. Baseline: ${baseMode}${arbitraryMode}${clutterMode}, frozen from ${(effective.frozenFrom?.sha ?? 'unknown').slice(0, 12)}.`,
  );
  process.exit(0);
}

function mainMergeBase() {
  try {
    git(['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main']);
    return git(['merge-base', 'HEAD', 'refs/remotes/origin/main']).trim();
  } catch {
    return '';
  }
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

if (!baseSha) baseSha = mainMergeBase();

if (writeMode) {
  writeBaseline(scanTree(), baseSha);
} else {
  check(baseSha);
}
