import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const runDir = process.argv[2];
if (!runDir) {
  console.error('usage: node analyze.mjs <run-dir>');
  process.exit(2);
}

const hoverLike = /^hover/;
const anchorTypes = (label) =>
  hoverLike.test(label) ? ['pointerover'] : ['pointerdown', 'keydown', 'wheel', 'click'];

const numbers = (v) => (String(v).match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

const progress = (series) => {
  if (series.length < 3) return null;
  const a = numbers(series[0].v);
  const b = numbers(series.at(-1).v);
  if (!a.length || a.length !== b.length) return null;
  let idx = -1;
  let span = 0;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(b[i] - a[i]) > span) {
      span = Math.abs(b[i] - a[i]);
      idx = i;
    }
  }
  if (idx < 0 || span === 0) return null;
  const t0 = series[0].t;
  return series.map((s) => {
    const n = numbers(s.v);
    return [
      Math.round(s.t - t0),
      n.length === a.length
        ? Math.round(((n[idx] - a[idx]) / (b[idx] - a[idx])) * 1000) / 1000
        : null,
    ];
  });
};

const analyzeJourney = (dir) => {
  const p = JSON.parse(readFileSync(join(dir, 'probe.json'), 'utf8'));
  const marks = p.marks;
  const out = [];
  const strips = join(dir, 'strips');
  mkdirSync(strips, { recursive: true });
  for (const step of p.steps) {
    const start = marks.find((m) => m.label === `start:${step.label}`)?.t;
    const end = marks.find((m) => m.label === `end:${step.label}`)?.t;
    if (!start || !end) continue;
    const evs = p.events.filter((e) => e.t >= start - 100 && e.t <= end);
    const anchorEv = evs.find((e) => anchorTypes(step.label).includes(e.type)) ?? evs[0];
    const anchor = anchorEv?.t ?? start;
    const windowFrames = p.frames.filter((f) => f.t >= anchor - 100 && f.t <= end);
    const prevFrame = [...p.frames].reverse().find((f) => f.t < anchor - 100);
    const changes = new Map();
    for (const f of windowFrames) {
      if (!f.d) continue;
      for (const [el, props] of Object.entries(f.d)) {
        for (const [prop, v] of Object.entries(props)) {
          if (prop === '_new') continue;
          const k = `${el} :: ${prop}`;
          if (!changes.has(k)) changes.set(k, { el, prop, isNew: !!props._new, series: [] });
          changes.get(k).series.push({ t: f.t, v });
        }
      }
    }
    const rows = [];
    for (const c of changes.values()) {
      if (c.isNew && c.series.length === 1) continue;
      const first = c.series[0].t - anchor;
      const last = c.series.at(-1).t - anchor;
      const cause = [...evs].reverse().find((e) => e.t <= c.series[0].t);
      rows.push({
        el: c.el,
        prop: c.prop,
        fromInputMs: cause ? Math.round(c.series[0].t - cause.t) : null,
        input: cause ? `${cause.type} ${cause.target.slice(0, 50)}` : null,
        firstMs: Math.round(first),
        lastMs: Math.round(last),
        durationMs: Math.round(last - first),
        steps: c.series.length,
        to: String(c.series.at(-1).v).slice(0, 120),
        values:
          c.series.length <= 6
            ? c.series.map((s) => [Math.round(s.t - anchor), String(s.v).slice(0, 80)])
            : undefined,
        curve: c.series.length > 6 ? progress(c.series) : undefined,
      });
    }
    rows.sort((a, b) => a.firstMs - b.firstMs);
    const scroll = windowFrames.filter((f) => f.s).map((f) => [Math.round(f.t - anchor), f.s]);
    const text = windowFrames.filter((f) => f.tl).map((f) => [Math.round(f.t - anchor), f.tl]);
    const muts = p.mutations
      .filter((m) => m.t >= anchor - 100 && m.t <= end)
      .map((m) => ({ ...m, t: Math.round(m.t - anchor) }));
    const frameTimes = windowFrames.map((f) => f.t);
    const intervals = frameTimes.slice(1).map((t, i) => t - frameTimes[i]);
    const sorted = [...intervals].sort((a, b) => a - b);
    const firstChange = rows.length ? rows[0].firstMs : null;
    const settle = rows.length ? Math.max(...rows.map((r) => r.lastMs)) : null;
    const stripFile = buildStrip(dir, p, step.label, anchor, settle, strips);
    out.push({
      label: step.label,
      error: step.error,
      anchor: anchorEv ? { type: anchorEv.type, target: anchorEv.target } : { type: 'mark' },
      firstChangeMs: firstChange,
      settleMs: settle,
      rafFrames: windowFrames.length,
      rafIntervalMedianMs: sorted.length
        ? Math.round(sorted[Math.floor(sorted.length / 2)] * 10) / 10
        : null,
      changes: rows,
      scroll,
      text,
      mutations: muts.slice(0, 60),
      mutationCount: muts.length,
      strip: stripFile,
      prevFrame: prevFrame ? Math.round(prevFrame.t - anchor) : null,
    });
  }
  writeFileSync(join(dir, 'analysis.json'), JSON.stringify(out, null, 1));
  writeFileSync(join(dir, 'analysis.md'), toMarkdown(p, out));
  return out;
};

const buildStrip = (dir, p, label, anchor, settle, strips) => {
  const castFile = join(dir, 'probe.json');
  if (!existsSync(castFile)) return null;
  const frameDir = existsSync(join(dir, 'frames-redacted'))
    ? join(dir, 'frames-redacted')
    : join(dir, 'frames');
  if (!existsSync(frameDir)) return null;
  const list = (p.cast ?? []).filter(
    (f) => f.ts >= anchor - 100 && f.ts <= anchor + Math.max(settle ?? 300, 300) + 120,
  );
  if (!list.length) return null;
  const reference = p.product === 'claude-ai';
  const mobile = p.width < 768;
  if (reference && mobile && ['hover-sidebar-rows', 'close-drawer'].includes(label)) return null;
  let crop = '';
  if (reference && !mobile) {
    const [w, h] = execFileSync('magick', [
      'identify',
      '-format',
      '%w %h',
      join(frameDir, list[0].file),
    ])
      .toString()
      .split(' ')
      .map(Number);
    const left = Math.round((290 * w) / p.viewport.width);
    crop = `[${w - left}x${h}+${left}+0]`;
  }
  const pick =
    list.length <= 16
      ? list
      : Array.from({ length: 16 }, (_, i) => list[Math.round((i * (list.length - 1)) / 15)]);
  const out = join(strips, `${label}.jpg`);
  const argsList = ['montage'];
  for (const f of pick)
    argsList.push('-label', `${Math.round(f.ts - anchor)}ms`, `${join(frameDir, f.file)}${crop}`);
  argsList.push(
    '-tile',
    `${Math.min(4, pick.length)}x`,
    '-geometry',
    '480x+4+4',
    '-pointsize',
    '18',
    '-background',
    '#808080',
    out,
  );
  try {
    execFileSync('magick', argsList);
  } catch {
    return null;
  }
  return `strips/${label}.jpg (${pick.length} of ${list.length} frames)`;
};

const toMarkdown = (p, out) => {
  const lines = [`# ${p.product} ${p.journey} ${p.width} ${p.scheme}`, ''];
  for (const s of out) {
    lines.push(`## ${s.label}`, '');
    lines.push(
      `anchor ${s.anchor.type} ${s.anchor.target ?? ''}; first change ${s.firstChangeMs ?? 'none'} ms; settled ${s.settleMs ?? 'n/a'} ms; rAF frames ${s.rafFrames}, median interval ${s.rafIntervalMedianMs} ms; mutations ${s.mutationCount}; strip ${s.strip ?? 'none'}${s.error ? `; ERROR ${s.error}` : ''}`,
      '',
    );
    if (s.changes.length) {
      lines.push(
        '| element | prop | ms from its input | first ms | last ms | frames | final | values or curve |',
        '|---|---|---|---|---|---|---|---|',
      );
      for (const r of s.changes.slice(0, 40)) {
        const vc = r.values
          ? r.values.map((v) => `${v[0]}:${v[1]}`).join(' / ')
          : r.curve
            ? r.curve
                .filter((_, i) => i % Math.ceil(r.curve.length / 12) === 0)
                .map((v) => `${v[0]}:${v[1]}`)
                .join(' ')
            : '';
        lines.push(
          `| ${r.el.replace(/\|/g, '/')} | ${r.prop} | ${r.fromInputMs ?? ''} (${(r.input ?? '').split(' ')[0]}) | ${r.firstMs} | ${r.lastMs} | ${r.steps} | ${r.to.replace(/\|/g, '/')} | ${vc.replace(/\|/g, '/')} |`,
        );
      }
      lines.push('');
    }
    if (s.scroll.length)
      lines.push(
        `scroll: ${s.scroll.length} frames; ${s.scroll
          .slice(0, 30)
          .map((x) => `${x[0]}:${x[1][0]}`)
          .join(' ')}`,
        '',
      );
    if (s.text.length)
      lines.push(
        `text length: ${s.text.length} changes; ${s.text
          .slice(0, 40)
          .map((x) => `${x[0]}:${x[1][0]}`)
          .join(' ')}`,
        '',
      );
  }
  return lines.join('\n');
};

for (const name of readdirSync(runDir, { withFileTypes: true })) {
  if (!name.isDirectory()) continue;
  const dir = join(runDir, name.name);
  if (!existsSync(join(dir, 'probe.json'))) continue;
  const res = analyzeJourney(dir);
  console.log(`${name.name}: ${res.length} steps analyzed`);
}
