import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { makeTestTempDir } from '../test-tmpdir.mjs';

const audit = fileURLToPath(new URL('./audit.mjs', import.meta.url));
const region = { name: 'sidebar', box: [0, 0.3, 0.3, 0.7] };

const textImage = (file) =>
  execFileSync('magick', [
    '-size',
    '400x300',
    'xc:#1f1f1f',
    '-fill',
    '#eeeeee',
    '-pointsize',
    '14',
    '-annotate',
    '+8+120',
    'Private chat title one',
    '-annotate',
    '+8+150',
    'Another private title',
    '-annotate',
    '+8+180',
    'Third title here',
    file,
  ]);

const fixtureDeny = join(makeTestTempDir('audit-deny-'), 'deny-list.json');
writeFileSync(fixtureDeny, JSON.stringify(['Secret Project', 'Quarterly plan']));

const run = (dir) =>
  spawnSync(process.execPath, [audit, dir], {
    encoding: 'utf8',
    env: { ...process.env, AUDIT_DENY_LIST: fixtureDeny },
  });

const fresh = () => makeTestTempDir('audit-test-');

test('a readable region fails even when marked reviewed', () => {
  const dir = fresh();
  textImage(join(dir, 'claude-ai-shot.png'));
  writeFileSync(
    join(dir, 'claude-ai-shot.png.redaction.json'),
    JSON.stringify({ regions: [region], reviewedClean: true }),
  );
  const r = run(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /looks readable/);
});

test('a pixelated region passes when marked reviewed', () => {
  const dir = fresh();
  const raw = join(dir, 'raw.png');
  textImage(raw);
  execFileSync('magick', [
    raw,
    '(',
    '+clone',
    '-crop',
    '120x210+0+90',
    '+repage',
    '-scale',
    '5%',
    '-scale',
    '120x210!',
    ')',
    '-geometry',
    '+0+90',
    '-composite',
    join(dir, 'claude-ai-shot.png'),
  ]);
  writeFileSync(
    join(dir, 'claude-ai-shot.png.redaction.json'),
    JSON.stringify({ regions: [region], reviewedClean: true }),
  );
  const r = run(join(dir, 'claude-ai-shot.png'));
  assert.equal(r.status, 0, r.stderr);
});

test('a capture without a sidecar fails', () => {
  const dir = fresh();
  textImage(join(dir, 'claude-ai-shot.png'));
  const r = run(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no .*redaction\.json/);
});

test('a capture nobody reviewed fails', () => {
  const dir = fresh();
  execFileSync('magick', ['-size', '100x100', 'xc:#1f1f1f', join(dir, 'claude-ai-blank.png')]);
  writeFileSync(
    join(dir, 'claude-ai-blank.png.redaction.json'),
    JSON.stringify({ regions: [], reviewedClean: false }),
  );
  const r = run(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /reviewedClean/);
});

test('visible text or chat ids in claude.ai logs fail; scrubbed logs pass', () => {
  const dir = fresh();
  writeFileSync(
    join(dir, 'claude-ai-dumps.json.gz'),
    gzipSync(
      JSON.stringify({ els: [{ key: 'span"A private title"#3', text: 'A private title' }] }),
    ),
  );
  writeFileSync(
    join(dir, 'claude-ai-probe.json'),
    JSON.stringify({ url: '/chat/00000000-0000-4000-8000-000000000000' }),
  );
  const bad = run(dir);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /visible text/);
  const clean = fresh();
  writeFileSync(
    join(clean, 'claude-ai-dumps.json.gz'),
    gzipSync(JSON.stringify({ els: [{ key: 'span"~"#3', text: '' }] })),
  );
  assert.equal(run(clean).status, 0);
});

test('a video with a readable region fails', () => {
  const dir = fresh();
  const still = join(dir, 'frame.png');
  textImage(still);
  const video = join(dir, 'claude-ai-clip.mp4');
  execFileSync('ffmpeg', [
    '-loglevel',
    'error',
    '-y',
    '-loop',
    '1',
    '-t',
    '1',
    '-i',
    still,
    '-vf',
    'scale=320:-2',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-r',
    '4',
    video,
  ]);
  writeFileSync(
    `${video}.redaction.json`,
    JSON.stringify({ regions: [region], reviewedClean: true }),
  );
  const r = run(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /looks readable/);
});

test('an aria title in a claude.ai dump key fails', () => {
  const dir = fresh();
  writeFileSync(
    join(dir, 'claude-ai-dumps.json'),
    JSON.stringify({
      initial: { els: [{ key: 'button[aria=Hide Unlisted thing ~]#4', text: '' }] },
    }),
  );
  const r = run(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /visible text/);
});

test('a deny-listed title fails in any text file, even one not named claude-ai', () => {
  const dir = fresh();
  writeFileSync(join(dir, 'motion-compare.md'), '| a[role=link] | opens Secret Project |');
  const r = run(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /deny-listed/);
  assert.doesNotMatch(r.stderr, /Secret Project/);
});

test('a missing deny list fails', () => {
  const dir = fresh();
  const r = spawnSync(process.execPath, [audit, dir], {
    encoding: 'utf8',
    env: { ...process.env, AUDIT_DENY_LIST: join(dir, 'none.json') },
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /deny list/);
});
