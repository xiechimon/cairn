import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { extname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';

const roots = process.argv.slice(2);
if (!roots.length) {
  console.error('usage: node audit.mjs <file-or-dir>...');
  process.exit(2);
}

const scratch = join(homedir(), '.cache', 'cairn-design-capture', 'audit-tmp');
mkdirSync(scratch, { recursive: true });
const media = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.webm']);
const isReference = (f) => /claude-ai|claude\.ai|claudeai/i.test(f);
const stillMax = Number(process.env.AUDIT_RMSE_MAX ?? 0.035);
const videoMax = Number(process.env.AUDIT_RMSE_VIDEO_MAX ?? 0.07);

const walk = (p) =>
  statSync(p).isDirectory() ? readdirSync(p).flatMap((f) => walk(join(p, f))) : [p];

const rmse = (image, region) => {
  const [x, y, w, h] = region;
  const size = execFileSync('magick', ['identify', '-format', '%w %h', `${image}[0]`])
    .toString()
    .split(' ')
    .map(Number);
  const geo = `${Math.max(1, Math.round(w * size[0]))}x${Math.max(1, Math.round(h * size[1]))}+${Math.round(x * size[0])}+${Math.round(y * size[1])}`;
  const out = execFileSync('sh', [
    '-c',
    `magick "${image}[0]" -crop ${geo} +repage -colorspace gray \\( +clone -scale 5% -scale ${geo.split('+')[0]}! \\) -metric RMSE -compare -format "%[distortion]" info: 2>&1 || true`,
  ]).toString();
  return Number(out.trim().split(/\s+/).pop());
};

const frames = (video, dir) => {
  execFileSync('ffmpeg', [
    '-loglevel',
    'error',
    '-i',
    video,
    '-vf',
    'fps=4',
    join(dir, 'f%05d.png'),
  ]);
  return readdirSync(dir).map((f) => join(dir, f));
};

const failures = [];
let checked = 0;
const textLeak = (json) => {
  const hits = [];
  const visit = (v, k) => {
    if (typeof v === 'string') {
      if (k === 'text' && v.length) hits.push(v.slice(0, 30));
      if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(v))
        hits.push('uuid');
      for (const m of v.matchAll(/"((?:[^"\\]|\\.)*)"(?=#\d)/g))
        if (m[1] !== '~') hits.push(m[1].slice(0, 30));
    } else if (Array.isArray(v)) {
      for (const x of v) visit(x);
    } else if (v && typeof v === 'object')
      for (const [kk, x] of Object.entries(v)) {
        visit(kk);
        visit(x, kk);
      }
  };
  visit(json);
  return hits;
};

for (const file of roots.flatMap(walk)) {
  const isJson = file.endsWith('.json') || file.endsWith('.json.gz');
  if (isJson && isReference(file) && !file.endsWith('.redaction.json')) {
    const raw = readFileSync(file);
    const hits = textLeak(
      JSON.parse((file.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8')),
    );
    checked++;
    if (hits.length)
      failures.push(
        `${file}: ${hits.length} visible text strings, e.g. ${JSON.stringify(hits.slice(0, 3))}`,
      );
    continue;
  }
  if (!media.has(extname(file).toLowerCase()) || !isReference(file)) continue;
  const sidecar = `${file}.redaction.json`;
  if (!existsSync(sidecar)) {
    failures.push(
      `${file}: no ${sidecar.split('/').pop()} listing the regions that must be pixelated`,
    );
    continue;
  }
  const spec = JSON.parse(readFileSync(sidecar, 'utf8'));
  const regions = spec.regions ?? [];
  if (spec.reviewedClean !== true)
    failures.push(`${file}: not marked reviewedClean after a person viewed every frame`);
  const isVideo = ['.mp4', '.webm', '.gif'].includes(extname(file).toLowerCase());
  const tmp = isVideo ? mkdtempSync(join(scratch, 'dc-audit-')) : null;
  const images = isVideo ? frames(file, tmp) : [file];
  for (const [i, img] of images.entries()) {
    const t = isVideo ? i / 4 : null;
    for (const r of regions) {
      if (r.from !== undefined && t !== null && (t < r.from || t > r.to)) continue;
      const d = rmse(img, r.box);
      checked++;
      const threshold = r.rmseMax ?? (isVideo ? videoMax : stillMax);
      if (!(d <= threshold))
        failures.push(
          `${file}${t !== null ? ` @${t.toFixed(2)}s` : ''}: region ${r.name ?? r.box.join(',')} looks readable (rmse ${d.toFixed(3)} > ${threshold})`,
        );
    }
  }
  if (tmp) rmSync(tmp, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`capture audit FAILED (${failures.length}):\n${failures.join('\n')}`);
  process.exit(1);
}
console.log(`capture audit PASS (${checked} region checks)`);
