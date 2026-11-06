#!/usr/bin/env node
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const SEVERITY = ['critical', 'serious', 'moderate', 'minor'];
const INLINE_LIMIT = 8;
const IMAGE_WIDTH = 320;

function listFiles(dir, suffix) {
  return existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => name.endsWith(suffix))
        .sort()
    : [];
}

function readLock(dir) {
  const file = join(dir, 'lock.sha256');
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : '';
}

function walk(dir, found = []) {
  if (!existsSync(dir)) return found;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, found);
    else found.push(path);
  }
  return found;
}

export function readAxe(dir) {
  const byPage = new Map();
  for (const name of listFiles(dir, '.axe.json')) {
    byPage.set(
      name.slice(0, -'.axe.json'.length),
      JSON.parse(readFileSync(join(dir, name), 'utf8')),
    );
  }
  return byPage;
}

export function commonPages(base, head) {
  return new Set([...base.keys()].filter((key) => head.has(key)));
}

function nodeMap(violations) {
  const nodes = new Map();
  for (const v of violations ?? []) {
    for (const target of v.targets) nodes.set(`${v.rule}\u0000${target}`, { ...v, target });
  }
  return nodes;
}

function groupNodes(page, nodes) {
  const groups = new Map();
  for (const node of nodes) {
    const group = groups.get(node.rule);
    if (group) group.nodes += 1;
    else
      groups.set(node.rule, {
        page,
        rule: node.rule,
        impact: node.impact,
        nodes: 1,
        target: node.target,
      });
  }
  return [...groups.values()];
}

export function diffAxe(base, head) {
  const added = [];
  const fixed = [];
  for (const key of [...commonPages(base, head)].sort()) {
    const before = nodeMap(base.get(key));
    const after = nodeMap(head.get(key));
    added.push(
      ...groupNodes(
        key,
        [...after].filter(([id]) => !before.has(id)).map(([, node]) => node),
      ),
    );
    fixed.push(
      ...groupNodes(
        key,
        [...before].filter(([id]) => !after.has(id)).map(([, node]) => node),
      ),
    );
  }
  return { added, fixed };
}

export function totals(axe, pages) {
  const counts = Object.fromEntries(SEVERITY.map((level) => [level, 0]));
  for (const [key, violations] of axe) {
    if (pages && !pages.has(key)) continue;
    for (const v of violations) counts[v.impact ?? 'minor'] += v.nodes;
  }
  return counts;
}

export function classify(base, head, failedNames) {
  const baseSet = new Set(base);
  const headSet = new Set(head);
  const changed = head.filter((name) => baseSet.has(name) && failedNames.has(name));
  const added = head.filter((name) => !baseSet.has(name));
  const removed = base.filter((name) => !headSet.has(name));
  const unchanged = head.length - changed.length - added.length;
  return { changed, added, removed, unchanged };
}

export function failedCompareFiles(results) {
  const failed = new Set();
  const visit = (suite) => {
    for (const spec of suite.specs ?? []) {
      if (spec.ok === false) failed.add(spec.title.replace(/^compare: /, ''));
    }
    for (const child of suite.suites ?? []) visit(child);
  };
  for (const suite of results.suites ?? []) visit(suite);
  return failed;
}

export function render({
  classes,
  axeDiff,
  baseTotals,
  headTotals,
  headErrors,
  baseErrors,
  durations,
  runUrl,
  assetBase,
  selection,
  comparedPages,
  lockfilesDiffer,
}) {
  const lines = ['### PR screenshots and accessibility (non-blocking)', ''];
  const duration = Object.entries(durations ?? {})
    .map(([name, seconds]) => `${name} ${Math.round(seconds)}s`)
    .join(', ');
  if (selection)
    lines.push(
      `Audited ${selection.count} of ${selection.total} pages${selection.all ? ' (a shared surface changed)' : ' (only the routes this diff touches)'}; baseline is the merge base on main.`,
      '',
    );
  lines.push(
    `Screens (page x theme): ${classes.changed.length} changed, ${classes.added.length} new, ${classes.removed.length} removed, ${classes.unchanged} unchanged.${duration ? ` Job time: ${duration}.` : ''}`,
    '',
  );
  if (lockfilesDiffer)
    lines.push(
      'Dependencies differ: each side was installed from its own pnpm-lock.yaml, so upgrades show in the screenshots.',
      '',
    );
  if (classes.changed.length + classes.added.length + classes.removed.length > 0) {
    lines.push('| Page | State |', '|---|---|');
    for (const name of classes.changed) lines.push(`| ${name.replace(/\.png$/, '')} | changed |`);
    for (const name of classes.added)
      lines.push(`| ${name.replace(/\.png$/, '')} | new on this head |`);
    for (const name of classes.removed)
      lines.push(`| ${name.replace(/\.png$/, '')} | not on this head |`);
    lines.push('');
  }
  if (assetBase && classes.changed.length > 0) {
    const image = (stem, kind) =>
      `<img src="${assetBase}/${stem}.${kind}.png" width="${IMAGE_WIDTH}" alt="${stem} ${kind}">`;
    lines.push('| Page | main | This head | Diff |', '|---|---|---|---|');
    for (const name of classes.changed.slice(0, INLINE_LIMIT)) {
      const stem = name.replace(/\.png$/, '');
      lines.push(
        `| ${stem} | ${image(stem, 'base')} | ${image(stem, 'head')} | ${image(stem, 'diff')} |`,
      );
    }
    if (classes.changed.length > INLINE_LIMIT)
      lines.push(
        '',
        `${classes.changed.length - INLINE_LIMIT} more changed pages are in the artifact.`,
      );
    lines.push('');
  }
  const level = (counts) => SEVERITY.map((s) => `${counts[s]} ${s}`).join(', ');
  lines.push(
    `axe (WCAG 2.2 AA), violating nodes on the ${comparedPages ?? 'audited'} screens rendered on both sides: base ${level(baseTotals)}; head ${level(headTotals)}.`,
    '',
  );
  if (axeDiff.added.length > 0) {
    lines.push(
      'New on this head, by rule and node:',
      '',
      '| Page | Rule | Impact | New nodes | First node |',
      '|---|---|---|---|---|',
    );
    for (const v of axeDiff.added)
      lines.push(`| ${v.page} | ${v.rule} | ${v.impact} | ${v.nodes} | \`${v.target}\` |`);
    lines.push('');
  }
  if (axeDiff.fixed.length > 0)
    lines.push(
      `Fixed on this head: ${axeDiff.fixed.map((v) => `${v.page} ${v.rule} (${v.nodes})`).join(', ')}.`,
      '',
    );
  if (headErrors.length + baseErrors.length > 0) {
    lines.push(
      `Screens that did not render: head ${headErrors.length}, base ${baseErrors.length} (see the artifact).`,
      '',
    );
  }
  lines.push(
    runUrl
      ? `Base, head and diff images of the changed pages: artifact \`pr-screens-report\` on ${runUrl}.`
      : 'Base, head and diff images of the changed pages are in the `pr-screens-report` artifact.',
  );
  return `${lines.join('\n')}\n`;
}

export function collectDiffImages(resultsDir, outDir, classes, headDir, baseDir) {
  mkdirSync(outDir, { recursive: true });
  const diffs = walk(resultsDir).filter((path) => path.endsWith('-diff.png'));
  for (const name of classes.changed) {
    const stem = name.replace(/\.png$/, '');
    copyFileSync(join(baseDir, name), join(outDir, `${stem}.base.png`));
    copyFileSync(join(headDir, name), join(outDir, `${stem}.head.png`));
    const diff = diffs.find((path) => path.endsWith(`${stem}-diff.png`));
    if (diff) copyFileSync(diff, join(outDir, `${stem}.diff.png`));
  }
  for (const name of classes.added)
    copyFileSync(join(headDir, name), join(outDir, `${name.replace(/\.png$/, '')}.head.png`));
}

function main(argv) {
  const option = (name) => argv[argv.indexOf(name) + 1];
  const headDir = option('--head');
  const baseDir = option('--base');
  const resultsDir = option('--results');
  const outDir = option('--out');
  const selection = argv.includes('--selection') ? JSON.parse(option('--selection')) : undefined;
  const durations = argv.includes('--durations') ? JSON.parse(option('--durations')) : {};
  const results = JSON.parse(readFileSync(join(resultsDir, 'results.json'), 'utf8'));
  const classes = classify(
    listFiles(baseDir, '.png'),
    listFiles(headDir, '.png'),
    failedCompareFiles(results),
  );
  const baseAxe = readAxe(baseDir);
  const headAxe = readAxe(headDir);
  const common = commonPages(baseAxe, headAxe);
  const markdown = render({
    classes,
    axeDiff: diffAxe(baseAxe, headAxe),
    baseTotals: totals(baseAxe, common),
    headTotals: totals(headAxe, common),
    comparedPages: common.size,
    lockfilesDiffer: readLock(baseDir) !== readLock(headDir),
    headErrors: listFiles(headDir, '.error.txt'),
    baseErrors: listFiles(baseDir, '.error.txt'),
    durations,
    runUrl: process.env.RUN_URL,
    assetBase: process.env.ASSET_BASE,
    selection,
  });
  collectDiffImages(resultsDir, outDir, classes, headDir, baseDir);
  writeFileSync(join(outDir, 'report.md'), markdown);
  process.stdout.write(markdown);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
