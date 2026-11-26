import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
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
  mkdirSync(join(root, 'apps', 'server'), { recursive: true });
  writeFileSync(join(root, 'apps/server/package.json'), '{}');
  symlinkSync(
    join(ROOT, 'apps/server/node_modules'),
    join(root, 'apps/server/node_modules'),
    'dir',
  );
  copyFileSync(SCRIPT, join(root, 'scripts', 'generate-canon.mjs'));
  const run = (...args) =>
    spawnSync(process.execPath, [join(root, 'scripts', 'generate-canon.mjs'), ...args], {
      encoding: 'utf8',
    });
  const put = ({ spec = goodSpec, rulings = [row], other, research } = {}) => {
    if (research) {
      mkdirSync(join(root, 'docs', 'research'), { recursive: true });
      writeFileSync(join(root, 'docs/research/x.md'), research);
    }
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

for (const [name, body] of [
  [
    'a lone comment opener sits mid-line',
    `Type <!-- to start one.\n\n${marked('a.team', SENTENCE)}\n`,
  ],
  ['an unpaired double tilde precedes it', `Costs ~~ about that. ${marked('a.team', SENTENCE)}\n`],
  [
    'an unquoted tag-like placeholder precedes it',
    `Use <s-id> here. ${marked('a.team', SENTENCE)}\n`,
  ],
  [
    'it continues a list item behind four spaces',
    `- Outer item\n\n    ${marked('a.team', SENTENCE)}\n`,
  ],
  [
    'an earlier paragraph left an inline tag open',
    `Press <s> now.\n\n${marked('a.team', SENTENCE)}\n`,
  ],
]) {
  test(`--check stays green when ${name}`, (t) => {
    const { run, put } = sandbox(t);
    put({ spec: `# 18\n\n## 4. Not to do\n\n${body}` });
    assert.equal(run().stderr, '');
    assert.equal(run('--check').status, 0);
  });
}

for (const [name, body, why] of [
  [
    'a longer fence holds a shorter one',
    `\`\`\`\`\n\`\`\`\n${marked('a.team', SENTENCE)}\n\`\`\`\`\n`,
    /inside a code block starting at line 1/,
  ],
  [
    'a fence sits in a blockquote',
    `> \`\`\`\n> ${marked('a.team', SENTENCE)}\n> \`\`\`\n`,
    /inside a code block/,
  ],
  [
    'a code span runs across lines',
    `Write \`this:\ntext ${marked('a.team', SENTENCE)}\nend\` now.\n`,
    /inside a code span/,
  ],
  [
    'a pre element holds it',
    `<pre>\n${marked('a.team', SENTENCE)}\n</pre>\n`,
    /inside a <pre> element/,
  ],
  [
    'a hidden element holds it',
    `<div hidden>\n\n${marked('a.team', SENTENCE)}\n\n</div>\n`,
    /inside a <div> element opened at line 1/,
  ],
  ['single tildes strike it', `~${marked('a.team', SENTENCE)}~\n`, /struck through/],
  [
    'an unclosed comment precedes it',
    `<!-- draft\n\n${marked('a.team', SENTENCE)}\n`,
    /inside a comment opened at line 1/,
  ],
]) {
  test(`--check is red and says why when ${name}`, (t) => {
    const { run, put } = sandbox(t);
    put({ spec: body });
    const result = run('--check');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /has no ruling mark/);
    assert.match(result.stderr, why);
  });
}

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
    { spec: `## 4. X\n\n~~Dropped:\nand ${marked('a.team', SENTENCE)}\ndone.~~\n` },
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
  [
    'a row points outside the spec folder',
    { rulings: [{ ...row, spec: 'docs/research/x.md' }], research: goodSpec, spec: '# 18\n' },
    /must be under docs\/spec\//,
  ],
  [
    'a row climbs out of the spec folder',
    {
      rulings: [{ ...row, spec: 'docs/spec/../research/x.md' }],
      research: goodSpec,
      spec: '# 18\n',
    },
    /must be under docs\/spec\//,
  ],
  [
    'a row points at a folder that only shares the prefix',
    { rulings: [{ ...row, spec: 'docs/spec-old/x.md' }] },
    /must be under docs\/spec\//,
  ],
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
