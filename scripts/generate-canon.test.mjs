import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { makeTestTempDir, releaseTestTempDir } from './test-tmpdir.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const SCRIPT = join(ROOT, 'scripts', 'generate-canon.mjs');
const SPEC = 'docs/spec/18-a.md';
const SENTENCE = 'No team features: another person runs their own copy of it.';
const marked = (id, text) => `<!-- ruling:${id} -->${text}<!-- /ruling -->`;
const row = { id: 'a.team', spec: SPEC, date: '2026-11-14' };
const goodSpec = `# 18\n\n## 4. Not to do\n\n- ${marked('a.team', SENTENCE)} More detail.\n`;

function sandbox(t) {
  const root = makeTestTempDir('canon-');
  t.after(() => releaseTestTempDir(root));
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'docs', 'canon'), { recursive: true });
  mkdirSync(join(root, 'docs', 'spec'));
  copyFileSync(SCRIPT, join(root, 'scripts', 'generate-canon.mjs'));
  const run = (...args) =>
    spawnSync(process.execPath, [join(root, 'scripts', 'generate-canon.mjs'), ...args], {
      encoding: 'utf8',
    });
  const put = ({ spec = goodSpec, rulings = [row], other } = {}) => {
    writeFileSync(join(root, SPEC), spec);
    if (other) writeFileSync(join(root, 'docs/spec/19-b.md'), other);
    writeFileSync(join(root, 'docs/canon/rulings.json'), JSON.stringify({ rulings }));
  };
  put();
  assert.equal(run().status, 0);
  assert.equal(run('--check').status, 0);
  return { run, put };
}

test('the committed canon is in step with the marked spec sentences', () => {
  const out = execFileSync('node', [SCRIPT, '--check'], { cwd: ROOT, encoding: 'utf8' });
  assert.match(out, /up to date/);
});

test('rewording the marked sentence leaves the canon stale', (t) => {
  const { run, put } = sandbox(t);
  put({ spec: goodSpec.replace('their own copy', 'a copy that is theirs') });
  assert.match(run('--check').stderr, /stale/);
});

test('quoted mark syntax, a closed comment and a nested list item keep the check green', (t) => {
  const { run, put } = sandbox(t);
  put({
    spec: `# 18\n\nWrap it in \`<!-- ruling:area.topic -->\`, and a lone \`<!--\` is only text.\n\n<!-- note -->\n\n## 4. Not to do\n\n- Outer\n    - ${marked('a.team', SENTENCE)} More detail.\n`,
  });
  assert.equal(run('--check').stderr, '');
});

test('code spans holding dots or tildes, and an unrelated earlier strikethrough, keep the check green', (t) => {
  const { run, put } = sandbox(t);
  const sentence = 'The gate judges the diff of `main...HEAD` and nothing older than that.';
  put({
    spec: `# 18\n\n~~Old text\n\n## 4. X\n\nType \`~~\` to strike. ${marked('a.team', sentence)}\n`,
  });
  assert.equal(run().stderr, '');
  assert.equal(run('--check').stderr, '');
});

for (const [name, change, message] of [
  ['the mark was removed', { spec: `## 4. X\n\n- ${SENTENCE}\n` }, /has no ruling mark/],
  ['the registry row was removed', { rulings: [{ ...row, id: 'a.other' }] }, /has no row/],
  ['the registry is empty', { rulings: [] }, /non-empty/],
  [
    'the row carries its own copy of the text',
    { rulings: [{ ...row, ruling: 'x' }] },
    /unknown key/,
  ],
  ['the mark is empty', { spec: marked('a.team', '') }, /no complete sentence/],
  [
    'the mark holds a placeholder',
    { spec: marked('a.team', 'TODO write the ruling about teams here later on.') },
    /no complete sentence/,
  ],
  ['the mark holds the id', { spec: marked('a.team', 'a.team') }, /no complete sentence/],
  [
    'the sentence is commented out',
    { spec: marked('a.team', `<!-- ${SENTENCE} -->`) },
    /no complete sentence/,
  ],
  [
    'the mark cuts the sentence short',
    { spec: marked('a.team', 'No team features: another person runs their own') },
    /sentence ends/,
  ],
  [
    'the mark sits in a code block',
    { spec: `\`\`\`\n${goodSpec}\n\`\`\`\n` },
    /has no ruling mark/,
  ],
  ['the mark is left open', { spec: `<!-- ruling:a.team -->${SENTENCE}\n` }, /same line/],
  [
    'the sentence is struck through',
    { spec: `~~${marked('a.team', SENTENCE)}~~\n` },
    /no ruling mark/,
  ],
  ['the mark sits inside a longer comment', { spec: `<!--\n${goodSpec}\n-->\n` }, /no ruling mark/],
  [
    'the mark sits in an indented code block',
    { spec: `## 4. X\n\n    ${marked('a.team', SENTENCE)}\n` },
    /no ruling mark/,
  ],
  [
    'a strikethrough runs across lines around the sentence',
    { spec: `## 4. X\n\n~~Dropped:\n${marked('a.team', SENTENCE)}\ndone.~~\n` },
    /no ruling mark/,
  ],
  [
    'the sentence sits inside a deleted-text element',
    { spec: `<del>\n${marked('a.team', SENTENCE)}\n</del>\n` },
    /no ruling mark/,
  ],
  [
    'the mark sits in inline code',
    { spec: `Write \`${marked('a.team', SENTENCE)}\` here.\n` },
    /no ruling mark/,
  ],
  [
    'two rulings share one sentence',
    {
      spec: `${goodSpec}\n${marked('a.again', SENTENCE)}\n`,
      rulings: [row, { ...row, id: 'a.again' }],
    },
    /repeats another ruling/,
  ],
  ['the id is marked twice', { spec: `${goodSpec}\n${goodSpec}` }, /marked twice/],
  ['the mark moved to another spec', { spec: '# 18\n', other: goodSpec }, /belongs in/],
]) {
  test(`--check is red when ${name}`, (t) => {
    const { run, put } = sandbox(t);
    put(change);
    const result = run('--check');
    assert.equal(result.status, 1);
    assert.match(result.stderr, message);
  });
}
