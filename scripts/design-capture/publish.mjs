import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const [finalDir, compareDir, outDir] = process.argv.slice(2);
if (!finalDir || !compareDir || !outDir) {
  console.error('usage: node publish.mjs <final-dir> <compare-dir> <out-dir>');
  process.exit(2);
}

const combos = ['1440-dark', '1440-light', '375-dark', '375-light'];
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

const duration = (f) =>
  Number(
    execFileSync('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'csv=p=0',
      f,
    ]).toString(),
  );

const index = [];
for (const combo of combos) {
  for (const product of ['claude-ai', 'cairn']) {
    for (const j of journeys) {
      const src = join(finalDir, `${product}-${combo}`, j);
      if (!existsSync(join(src, 'probe.json'))) continue;
      const dst = join(outDir, `${product}-${combo}`, j);
      mkdirSync(join(dst, 'strips'), { recursive: true });
      const probe = JSON.parse(readFileSync(join(src, 'probe.json'), 'utf8'));
      if (product === 'claude-ai' && !probe.redacted) throw new Error(`${src} is not redacted`);
      writeFileSync(
        join(dst, `${product}-probe.json.gz`),
        gzipSync(readFileSync(join(src, 'probe.json'))),
      );
      if (existsSync(join(src, 'dumps.json')))
        writeFileSync(
          join(dst, `${product}-dumps.json.gz`),
          gzipSync(readFileSync(join(src, 'dumps.json'))),
        );
      for (const f of ['analysis.json', 'analysis.md'])
        if (existsSync(join(src, f))) copyFileSync(join(src, f), join(dst, `${product}-${f}`));
      const video = `${product}-${j}-${combo.split('-')[0]}-${combo.split('-')[1]}.mp4`;
      if (existsSync(join(src, video))) {
        copyFileSync(join(src, video), join(dst, video));
        if (existsSync(join(src, `${video}.redaction.json`)))
          copyFileSync(join(src, `${video}.redaction.json`), join(dst, `${video}.redaction.json`));
      }
      if (existsSync(join(src, 'strips')))
        for (const s of readdirSync(join(src, 'strips'))) {
          const name = `${product}-${s}`;
          copyFileSync(join(src, 'strips', s), join(dst, 'strips', name));
          if (product === 'claude-ai')
            writeFileSync(
              join(dst, 'strips', `${name}.redaction.json`),
              JSON.stringify({
                regions: [],
                reviewedClean: false,
                note: 'desktop strips are cropped right of the sidebar; mobile drawer steps have no strip',
              }),
            );
        }
      index.push({
        combo,
        product,
        journey: j,
        video: existsSync(join(dst, video)) ? `${product}-${combo}/${j}/${video}` : null,
      });
    }
    const cmp = join(compareDir, combo);
    if (existsSync(cmp)) {
      const cdst = join(outDir, 'compare', combo);
      mkdirSync(join(cdst, 'pairs'), { recursive: true });
      for (const f of ['motion-compare.md', 'style-diff.md'])
        if (existsSync(join(cmp, f))) copyFileSync(join(cmp, f), join(cdst, f));
      if (existsSync(join(cmp, 'pairs')))
        for (const s of readdirSync(join(cmp, 'pairs'))) {
          const name = `claude-ai-vs-cairn-${s}`;
          copyFileSync(join(cmp, 'pairs', s), join(cdst, 'pairs', name));
          writeFileSync(
            join(cdst, 'pairs', `${name}.redaction.json`),
            JSON.stringify({
              regions: [],
              reviewedClean: false,
              note: 'top half is the cropped claude.ai strip',
            }),
          );
        }
    }
  }
  for (const j of journeys) {
    const a = join(
      outDir,
      `claude-ai-${combo}`,
      j,
      `claude-ai-${j}-${combo.split('-')[0]}-${combo.split('-')[1]}.mp4`,
    );
    const b = join(
      outDir,
      `cairn-${combo}`,
      j,
      `cairn-${j}-${combo.split('-')[0]}-${combo.split('-')[1]}.mp4`,
    );
    if (!existsSync(a) || !existsSync(b)) continue;
    const pdir = join(outDir, 'pairs', combo);
    mkdirSync(pdir, { recursive: true });
    const out = join(pdir, `claude-ai-vs-cairn-${j}-${combo}.mp4`);
    const d = Math.max(duration(a), duration(b));
    const mobile = combo.startsWith('375');
    const fit = mobile ? 'scale=-2:812' : 'scale=960:-2';
    execFileSync('ffmpeg', [
      '-loglevel',
      'error',
      '-y',
      '-i',
      a,
      '-i',
      b,
      '-filter_complex',
      `[0:v]${fit},tpad=stop_mode=clone:stop_duration=${d},trim=duration=${d},drawtext=text='claude.ai':x=12:y=12:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.6[l];[1:v]${fit},tpad=stop_mode=clone:stop_duration=${d},trim=duration=${d},drawtext=text='cairn':x=12:y=12:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.6[r];[l][r]hstack=inputs=2`,
      '-c:v',
      'libx264',
      '-crf',
      '26',
      '-pix_fmt',
      'yuv420p',
      '-r',
      '60',
      out,
    ]);
    const side = existsSync(`${a}.redaction.json`)
      ? JSON.parse(readFileSync(`${a}.redaction.json`, 'utf8'))
      : { regions: [] };
    const regions = side.regions.map((r) => ({
      ...r,
      box: [r.box[0] / 2, r.box[1], r.box[2] / 2, r.box[3]],
    }));
    writeFileSync(
      `${out}.redaction.json`,
      JSON.stringify({ regions, reviewedClean: false }, null, 1),
    );
  }
}
writeFileSync(join(outDir, 'index.json'), JSON.stringify(index, null, 1));
console.log(`published ${index.length} journey captures to ${outDir}`);
