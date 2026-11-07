import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [refRun, oursRun, outDir] = process.argv.slice(2);
if (!refRun || !oursRun || !outDir) {
  console.error('usage: node compare-motion.mjs <claude-ai-run> <cairn-run> <out-dir>');
  process.exit(2);
}
mkdirSync(join(outDir, 'pairs'), { recursive: true });

const load = (run, j) => {
  const f = join(run, j, 'analysis.json');
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
};

const visual = (r) => !['rect'].includes(r.prop) || r.steps > 1;

const describe = (s) => {
  if (!s) return 'not captured';
  if (s.error) return `step failed: ${s.error.slice(0, 80)}`;
  const rows = s.changes.filter(visual);
  if (!rows.length && !s.scroll.length && !s.mutationCount) return 'no visual change';
  const parts = [];
  const instant = rows.filter((r) => r.steps === 1);
  const animated = rows.filter((r) => r.steps > 1);
  if (instant.length) {
    const d = Math.min(...instant.map((r) => r.fromInputMs ?? r.firstMs));
    parts.push(
      `${instant.length} props jump in one frame, ${d} ms after input (${[...new Set(instant.map((r) => r.prop))].slice(0, 5).join(', ')})`,
    );
  }
  for (const r of animated.slice(0, 4)) {
    parts.push(
      `${r.prop} on ${r.el.split('#')[0].slice(0, 40)}: starts ${r.fromInputMs ?? r.firstMs} ms after input, runs ${r.durationMs} ms over ${r.steps} frames${
        r.curve
          ? `, curve ${r.curve
              .filter((_, i) => i % Math.ceil(r.curve.length / 6) === 0)
              .map((v) => `${v[0]}:${v[1]}`)
              .join(' ')}`
          : ''
      }`,
    );
  }
  if (s.scroll.length) {
    const first = s.scroll[0];
    const last = s.scroll.at(-1);
    parts.push(
      `scroll ${s.scroll.length} frames from ${first[0]} to ${last[0]} ms, top ${first[1][0]} to ${last[1][0]}`,
    );
  }
  if (s.text.length) {
    const first = s.text[0];
    const last = s.text.at(-1);
    parts.push(
      `text grows ${first[1][0]} to ${last[1][0]} chars in ${s.text.length} updates over ${last[0] - first[0]} ms`,
    );
  }
  if (s.mutationCount) parts.push(`${s.mutationCount} DOM mutations`);
  return parts.join('; ');
};

const pairStrip = (a, b, j, label) => {
  const sa = a?.strip && join(refRun, j, a.strip.split(' ')[0]);
  const sb = b?.strip && join(oursRun, j, b.strip.split(' ')[0]);
  if (!sa || !sb || !existsSync(sa) || !existsSync(sb)) return null;
  const out = join(outDir, 'pairs', `${j}--${label}.jpg`);
  try {
    execFileSync('magick', [
      sa,
      '-resize',
      '1600x',
      '(',
      '-size',
      '1600x40',
      'xc:#202020',
      '-fill',
      'white',
      '-pointsize',
      '22',
      '-gravity',
      'west',
      '-annotate',
      '+12+0',
      'cairn (below)',
      ')',
      sb,
      '-resize',
      '1600x',
      '-append',
      out,
    ]);
  } catch {
    return null;
  }
  return `pairs/${j}--${label}.jpg`;
};

const lines = [
  '# Motion comparison: claude.ai vs cairn',
  '',
  `claude.ai run \`${refRun}\`, cairn run \`${oursRun}\``,
  '',
  'Times are ms from the input event that caused the change (pointerover for hover, pointerdown, keydown or wheel otherwise), taken from the rAF probe log; a strip shows the screencast frames in the same window.',
  '',
];
for (const j of [
  'shell',
  'chat-long',
  'send-stream',
  'artifact',
  'tool-search',
  'search-palette',
  'focus',
  'settings',
  'projects',
]) {
  const a = load(refRun, j);
  const b = load(oursRun, j);
  if (!a && !b) continue;
  lines.push(`## ${j}`, '', '| step | claude.ai | cairn | frames |', '|---|---|---|---|');
  const labels = [...new Set([...(a ?? []).map((s) => s.label), ...(b ?? []).map((s) => s.label)])];
  for (const label of labels) {
    const sa = a?.find((s) => s.label === label);
    const sb = b?.find((s) => s.label === label);
    const strip = pairStrip(sa, sb, j, label);
    lines.push(
      `| ${label} | ${describe(sa).replace(/\|/g, '/')} | ${describe(sb).replace(/\|/g, '/')} | ${strip ? `[strip](${strip})` : ''} |`,
    );
  }
  lines.push('');
}
writeFileSync(join(outDir, 'motion-compare.md'), lines.join('\n'));
console.log(`wrote ${join(outDir, 'motion-compare.md')}`);
