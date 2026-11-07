import { execFile, execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const runDir = process.argv[2];
if (!runDir) {
  console.error('usage: node redact.mjs <claude-ai-run-dir>');
  process.exit(2);
}

const scrubKey = (s) =>
  s
    .replace(/"(?:[^"\\]|\\.)*"(?=#\d)/g, '"~"')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '~')
    .replace(
      /\[aria=([^\]]*)\]/g,
      (_, v) =>
        `[aria=${v.split(' ').slice(0, 3).join(' ')}${v.split(' ').length > 3 ? ' ~' : ''}]`,
    );

const scrubDeep = (v) => {
  if (typeof v === 'string') return scrubKey(v);
  if (Array.isArray(v)) return v.map(scrubDeep);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) out[scrubKey(k)] = k === 'text' ? '' : scrubDeep(x);
    return out;
  }
  return v;
};

const run = promisify(execFile);
const jobs = [];
const blur = (files, region) => {
  for (const f of files) jobs.push([f, region]);
};
const flush = async (frameDir, outDir, all) => {
  mkdirSync(outDir, { recursive: true });
  const byFile = new Map();
  for (const [f, r] of jobs) {
    if (!byFile.has(f)) byFile.set(f, []);
    byFile.get(f).push(r);
  }
  jobs.length = 0;
  const tasks = [];
  for (const f of all) {
    const src = join(frameDir, f);
    const dst = join(outDir, f);
    const regions = byFile.get(src) ?? [];
    if (!regions.length) {
      copyFileSync(src, dst);
      continue;
    }
    const argv = [src];
    for (const r of regions) {
      const [wh, x, y] = r.split('+');
      argv.push(
        '(',
        '+clone',
        '-crop',
        r,
        '+repage',
        '-scale',
        '5%',
        '-scale',
        `${wh}!`,
        ')',
        '-geometry',
        `+${x}+${y}`,
        '-composite',
      );
    }
    argv.push(dst);
    tasks.push(argv);
  }
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const argv = tasks[next++];
      await run('magick', argv);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
};

for (const entry of readdirSync(runDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const dir = join(runDir, entry.name);
  const probeFile = join(dir, 'probe.json');
  if (!existsSync(probeFile)) continue;
  const probe = JSON.parse(readFileSync(probeFile, 'utf8'));
  const dumpsFile = join(dir, 'dumps.json');
  const dumps = existsSync(dumpsFile) ? JSON.parse(readFileSync(dumpsFile, 'utf8')) : {};
  const mobile = probe.width < 768;
  const frameDir = join(dir, 'frames');
  const cast = (probe.cast ?? []).filter((f) => existsSync(join(frameDir, f.file)));
  if (!cast.length) continue;
  const frameWidth = Number(
    execFileSync('magick', ['identify', '-format', '%w', join(frameDir, cast[0].file)]).toString(),
  );
  const scale = frameWidth / probe.viewport.width;
  const r = (w, h, x, y) =>
    `${Math.round(w * scale)}x${Math.round(h * scale)}+${Math.round(x * scale)}+${Math.round(y * scale)}`;
  const outDir = join(dir, 'frames-redacted');
  const mark = (label) => probe.marks.find((m) => m.label === label)?.t;
  const inWindow = (a, b) =>
    cast
      .filter((f) => a && b && f.ts >= a - 50 && f.ts <= b + 50)
      .map((f) => join(frameDir, f.file));
  const vw0 = probe.viewport.width;
  const vh0 = probe.viewport.height;
  const specs = [];
  if (!mobile)
    specs.push({
      name: 'sidebar-from-pinned',
      box: [0, 250, 290, vh0 - 250],
      from: null,
      to: null,
    });
  if (mobile) {
    let openAt = null;
    let lastT = null;
    for (const f of probe.frames) {
      for (const [k, v] of Object.entries(f.d ?? {})) {
        if (!k.startsWith('div[role=dialog][aria=Sidebar') || !v.rect) continue;
        const x = Number(v.rect.split(',')[0]);
        if (x > -370 && openAt === null) openAt = f.t;
        if (x <= -370 && openAt !== null) {
          specs.push({
            name: 'drawer',
            box: [0, 250, vw0, vh0 - 250],
            from: openAt - 100,
            to: f.t + 100,
          });
          openAt = null;
        }
      }
      lastT = f.t;
    }
    if (openAt !== null)
      specs.push({ name: 'drawer', box: [0, 250, vw0, vh0 - 250], from: openAt - 100, to: lastT });
  }
  if (mark('start:open-palette') && mark('end:type-query'))
    specs.push({
      name: 'palette-recents',
      box: [0, 0, vw0, vh0],
      from: mark('start:open-palette') - 100,
      to: mark('end:type-query'),
    });
  const composer = (dumps.initial?.els ?? []).find((e) => (e.roles ?? []).includes('composer.box'));
  const sent = Object.entries(dumps).some(
    ([k, v]) =>
      k !== 'initial' && (v.els ?? []).some((e) => (e.roles ?? []).includes('message.user')),
  );
  const sendLabel = sent ? probe.steps.map((s) => s.label).find((l) => /^send/.test(l)) : undefined;
  if (
    composer &&
    [
      'shell',
      'search-palette',
      'focus',
      'send-stream',
      'artifact',
      'tool-search',
      'settings',
    ].includes(probe.journey)
  ) {
    const dialogGone = probe.frames.find((f) =>
      Object.entries(f.d ?? {}).some(
        ([k, v]) =>
          k.startsWith('div[role=dialog]') &&
          !k.includes('aria=Sidebar') &&
          v.opacity !== undefined &&
          Number(v.opacity) < 0.5 &&
          f.t > (probe.marks[0]?.t ?? 0) + 500,
      ),
    )?.t;
    const after =
      probe.journey === 'settings'
        ? Math.min(
            dialogGone ?? Number.POSITIVE_INFINITY,
            mark('start:close-dialog') ?? Number.POSITIVE_INFINITY,
          ) - 150
        : null;
    const gTop = mobile ? 56 : Math.max(0, Math.round(composer.rect[1] - 110));
    specs.push({
      name: 'greeting',
      box: [0, gTop, vw0, Math.round(composer.rect[1] - 4) - gTop],
      from: after,
      to: sendLabel ? mark(`start:${sendLabel}`) : null,
    });
    const top = Math.round(composer.rect[1] + composer.rect[3] + 28);
    specs.push({
      name: 'recent-artifacts',
      box: [0, top, vw0, vh0 - top],
      from: after,
      to: sendLabel ? mark(`start:${sendLabel}`) : null,
    });
  }
  if (probe.journey === 'projects')
    specs.push({
      name: 'project-list',
      box: [mobile ? 0 : 290, 90, mobile ? vw0 : vw0 - 290, vh0 - 90],
      from: null,
      to: null,
    });
  for (const sp of specs) {
    const frames =
      sp.from || sp.to
        ? inWindow(sp.from ?? cast[0].ts, sp.to ?? cast.at(-1).ts)
        : cast.map((f) => join(frameDir, f.file));
    blur(frames, r(sp.box[2], sp.box[3], sp.box[0], sp.box[1]));
  }
  await flush(
    frameDir,
    outDir,
    cast.map((f) => f.file),
  );
  const sorted = [...cast].sort((a, b) => a.ts - b.ts);
  if (sorted.length > 1) {
    const lines = ['ffconcat version 1.0'];
    sorted.forEach((f, i) => {
      const next = sorted[i + 1]?.ts ?? f.ts + 500;
      lines.push(
        `file '${join(outDir, f.file)}'`,
        `duration ${(Math.max(1, next - f.ts) / 1000).toFixed(4)}`,
      );
    });
    lines.push(`file '${join(outDir, sorted.at(-1).file)}'`);
    writeFileSync(join(outDir, 'frames.ffconcat'), lines.join('\n'));
    const video = join(dir, `${probe.product}-${probe.journey}-${probe.width}-${probe.scheme}.mp4`);
    execFileSync('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      join(outDir, 'frames.ffconcat'),
      '-vf',
      'fps=60,scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:v',
      'libx264',
      '-crf',
      '24',
      '-pix_fmt',
      'yuv420p',
      video,
    ]);
    const t0 = sorted[0].ts;
    const secs = (t) => Math.max(0, Math.round((t - t0) / 10) / 100);
    const regions = specs.map((sp) => ({
      name: sp.name,
      box: [sp.box[0] / vw0, sp.box[1] / vh0, sp.box[2] / vw0, sp.box[3] / vh0],
      ...(sp.from || sp.to
        ? {
            from: secs(sp.from ?? t0) + 0.05,
            to: Math.max(0, secs(sp.to ?? sorted.at(-1).ts) - 0.05),
          }
        : {}),
    }));
    writeFileSync(
      `${video}.redaction.json`,
      JSON.stringify({ regions, reviewedClean: false }, null, 1),
    );
  }
  writeFileSync(probeFile, JSON.stringify({ ...scrubDeep(probe), redacted: true }));
  if (existsSync(dumpsFile)) writeFileSync(dumpsFile, JSON.stringify(scrubDeep(dumps)));
  console.log(`${entry.name}: redacted ${cast.length} frames`);
}
