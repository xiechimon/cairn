import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [refRun, oursRun, outFile] = process.argv.slice(2);
if (!refRun || !oursRun || !outFile) {
  console.error('usage: node style-diff.mjs <claude-ai-run> <cairn-run> <out.md>');
  process.exit(2);
}

const ignore = new Set(['width', 'height', 'transitionDelay']);
const histProps = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'color',
  'backgroundColor',
  'borderTopLeftRadius',
  'boxShadow',
  'borderTopColor',
  'borderTopWidth',
  'paddingTop',
  'paddingLeft',
  'rowGap',
  'columnGap',
  'transitionDuration',
  'transitionTimingFunction',
  'animationName',
  'strokeWidth',
];

const family = (v) => v.split(',')[0].replace(/"/g, '').trim();
const norm = (prop, v) => {
  if (v == null) return '';
  if (prop === 'fontFamily') return family(v);
  if (prop === 'boxShadow')
    return (
      v
        .split(/,(?![^(]*\))/)
        .map((x) => x.trim())
        .filter((x) => !/^rgba\(0, 0, 0, 0\)/.test(x) && !/ 0px 0px 0px 0px$/.test(x))
        .join(', ') || 'none'
    );
  return v;
};

const load = (run, journey) => {
  const f = join(run, journey, 'dumps.json');
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
};

const byRole = (dump) => {
  const m = new Map();
  for (const e of dump.els)
    for (const r of e.roles ?? []) {
      if (!m.has(r)) m.set(r, []);
      m.get(r).push(e);
    }
  return m;
};

const hist = (dump) => {
  const h = {};
  for (const p of histProps) h[p] = new Map();
  for (const e of dump.els) {
    const textual = (e.text && e.text.length > 0) || /"[^"]*"#\d/.test(e.key);
    for (const p of histProps) {
      if (
        ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'color'].includes(
          p,
        ) &&
        !textual
      )
        continue;
      const v = norm(p, e.s[p]);
      if (p === 'backgroundColor' && v === 'rgba(0, 0, 0, 0)') continue;
      if (p === 'borderTopLeftRadius' && v === '0px') continue;
      if (p === 'boxShadow' && v === 'none') continue;
      if (p === 'borderTopWidth' && v === '0px') continue;
      if (p === 'borderTopColor' && e.s.borderTopWidth === '0px') continue;
      if (
        (p === 'paddingTop' || p === 'paddingLeft' || p === 'rowGap' || p === 'columnGap') &&
        (v === '0px' || v === 'normal')
      )
        continue;
      if ((p === 'transitionDuration' && v === '0s') || (p === 'animationName' && v === 'none'))
        continue;
      if (p === 'transitionTimingFunction' && e.s.transitionDuration === '0s') continue;
      if (p === 'strokeWidth' && !e.key.startsWith('svg')) continue;
      h[p].set(v, (h[p].get(v) ?? 0) + 1);
    }
  }
  return h;
};

const fmtHist = (m) =>
  [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([v, n]) => `${v.slice(0, 60)} x${n}`)
    .join('<br>');

const lines = [
  '# Style diff: claude.ai vs cairn',
  '',
  `Reference run: \`${refRun}\``,
  `Ours run: \`${oursRun}\``,
  '',
];
const journeys = [
  'shell',
  'chat-long',
  'send-stream',
  'artifact',
  'tool-search',
  'search-palette',
  'focus',
  'settings',
  'projects',
];
for (const j of journeys) {
  const a = load(refRun, j);
  const b = load(oursRun, j);
  if (!a || !b) continue;
  for (const state of Object.keys(a)) {
    if (!b[state]) continue;
    const da = a[state];
    const db = b[state];
    lines.push(
      `## ${j} / ${state}`,
      '',
      `viewport claude.ai ${da.viewport.join('x')}, cairn ${db.viewport.join('x')}; elements ${da.els.length} vs ${db.els.length}`,
      '',
    );
    const ra = byRole(da);
    const rb = byRole(db);
    const roles = [...new Set([...ra.keys(), ...rb.keys()])].sort();
    lines.push('| role | prop | claude.ai | cairn |', '|---|---|---|---|');
    for (const role of roles) {
      const ea = ra.get(role);
      const eb = rb.get(role);
      if (!ea || !eb) {
        lines.push(
          `| ${role} | presence | ${ea ? ea.length : 'absent'} | ${eb ? eb.length : 'absent'} |`,
        );
        continue;
      }
      const x = ea[0];
      const y = eb[0];
      lines.push(
        `| ${role} | count, size | ${ea.length}, ${x.rect[2]}x${x.rect[3]} | ${eb.length}, ${y.rect[2]}x${y.rect[3]} |`,
      );
      for (const p of Object.keys(x.s)) {
        if (ignore.has(p)) continue;
        const va = norm(p, x.s[p]);
        const vb = norm(p, y.s[p]);
        if (va !== vb)
          lines.push(
            `| ${role} | ${p} | ${va.slice(0, 90).replace(/\|/g, '/')} | ${vb.slice(0, 90).replace(/\|/g, '/')} |`,
          );
      }
      for (const ps of new Set([...Object.keys(x.pseudo ?? {}), ...Object.keys(y.pseudo ?? {})])) {
        const pa = JSON.stringify(x.pseudo?.[ps] ?? null);
        const pb = JSON.stringify(y.pseudo?.[ps] ?? null);
        if (pa !== pb)
          lines.push(
            `| ${role} | ${ps} | ${pa.slice(0, 90).replace(/\|/g, '/')} | ${pb.slice(0, 90).replace(/\|/g, '/')} |`,
          );
      }
    }
    lines.push(
      '',
      '### Value sets on the page (catch-all)',
      '',
      '| prop | claude.ai | cairn |',
      '|---|---|---|',
    );
    const ha = hist(da);
    const hb = hist(db);
    for (const p of histProps)
      lines.push(
        `| ${p} (${ha[p].size} vs ${hb[p].size}) | ${fmtHist(ha[p]).replace(/\|/g, '/')} | ${fmtHist(hb[p]).replace(/\|/g, '/')} |`,
      );
    lines.push(
      '',
      `root custom properties: claude.ai ${Object.keys(da.vars).length}, cairn ${Object.keys(db.vars).length}`,
      '',
    );
  }
}
writeFileSync(outFile, lines.join('\n'));
console.log(`wrote ${outFile}`);
