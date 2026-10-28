import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { makeTestTempDir } from './test-tmpdir.mjs';

const GATE = resolve('scripts/recording-gate.mjs');
const GIT_ENV = {
  GIT_AUTHOR_NAME: 'gate',
  GIT_AUTHOR_EMAIL: 'gate@example.com',
  GIT_COMMITTER_NAME: 'gate',
  GIT_COMMITTER_EMAIL: 'gate@example.com',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
};

const motionCard = [
  'export function Card() {',
  '  return <article className="card">{title}</article>;',
  '}',
].join('\n');
const animatedCard = motionCard.replace(
  '</article>',
  '</article>;\n}\n// transition\ntransition: transform 200ms;',
);

function repo({ files = {}, evidence = {}, motion = null } = {}) {
  const dir = makeTestTempDir('recording-gate-');
  const git = (...args) =>
    execFileSync('git', args, { cwd: dir, env: { ...process.env, ...GIT_ENV }, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('commit', '-q', '--allow-empty', '-m', 'base');
  git('checkout', '-q', '-b', 'lane/1783');
  const write = (path, body) => {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), body);
  };
  for (const [path, body] of Object.entries(files)) write(path, body);
  for (const [path, body] of Object.entries(evidence)) write(path, body);
  if (motion !== null) write('apps/web/src/styles/motion.css', `${motion}\n`);
  git('add', '-A');
  git('commit', '-q', '-m', 'change');
  return {
    dir,
    run: (args = []) => {
      try {
        return {
          status: 0,
          output: execFileSync(process.execPath, [GATE, '--repo', dir, '--base', 'main', ...args], {
            cwd: dir,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
          }),
        };
      } catch (error) {
        return { status: error.status ?? 1, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
      }
    },
    commit: (message) => {
      git('add', '-A');
      git('commit', '-q', '-m', message);
    },
  };
}

test('a copy-only web change exits 0 without a recording', () => {
  const r = repo({ files: { 'apps/web/src/board/card.tsx': motionCard } });
  const result = r.run();
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /recording-gate: OK/);
});

test('a copy-only web change with two ticket evidence directories exits 0', () => {
  const r = repo({
    files: { 'apps/web/src/board/card.tsx': motionCard },
    evidence: {
      'docs/verify/1783/after.png': 'png',
      'docs/verify/1937/after.png': 'png',
    },
  });
  const result = r.run();
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /no added line animates or drives an interaction/);
});

test('the issue example (transition: transform 200ms) with only PNGs exits 1', () => {
  const r = repo({
    files: { 'apps/web/src/board/card.tsx': animatedCard },
    evidence: {
      'docs/verify/1783/after.png': 'png',
      'docs/verify/1783/result.json': '{}',
    },
  });
  const result = r.run();
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /recording-missing/);
  assert.match(result.output, /transition: transform 200ms/);
});

test('the same change plus a WebM under docs/verify/1783 exits 0', () => {
  const r = repo({
    files: { 'apps/web/src/board/card.tsx': animatedCard },
    evidence: {
      'docs/verify/1783/after.png': 'png',
      'docs/verify/1783/interaction.webm': 'x'.repeat(1024),
    },
  });
  const result = r.run();
  assert.equal(result.status, 0, result.output);
});

test('a 6 MB recording exits 1 with a size reason', () => {
  const r = repo({
    files: { 'apps/web/src/board/card.tsx': animatedCard },
    evidence: {
      'docs/verify/1783/interaction.webm': Buffer.alloc(6 * 1024 * 1024, 'a'),
      'docs/verify/1783/after.png': 'png',
    },
  });
  const result = r.run();
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /6291456 bytes, at most 5242880/);
});

test('a recording parked outside the ticket evidence directory does not satisfy the gate', () => {
  const r = repo({
    files: { 'apps/web/src/board/card.tsx': animatedCard },
    evidence: {
      'docs/verify/1783/after.png': 'png',
      'docs/verify/926/interaction.webm': 'x'.repeat(1024),
    },
  });
  const result = r.run(['--ticket', '1783']);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /recording-missing/);
});

test('a motion token file change with no recording exits 1', () => {
  const r = repo({
    files: {},
    evidence: { 'docs/verify/1783/after.png': 'png' },
    motion: '@keyframes card-enter { from { opacity: 0 } }',
  });
  const result = r.run();
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /apps\/web\/src\/styles\/motion\.css/);
});

test('two ticket evidence directories in one branch exit 2 instead of picking one', () => {
  const r = repo({
    files: { 'apps/web/src/board/card.tsx': animatedCard },
    evidence: {
      'docs/verify/1783/after.png': 'png',
      'docs/verify/1937/after.png': 'png',
    },
  });
  const result = r.run();
  assert.equal(result.status, 2, result.output);
  assert.match(result.output, /two ticket evidence directories/);
});

test('a merged PR that shipped motion with only PNGs is red on replay (real history #1972)', () => {
  const lesson = join(
    import.meta.dirname,
    '..',
    'docs/lessons/1937-evidence-shot-mid-animation.md',
  );
  assert.match(readFileSync(lesson, 'utf8'), /animation/);
  const r = repo({
    files: {},
    evidence: { 'docs/verify/1937/shot.png': 'png' },
    motion:
      '.anim-saved-check {\n  animation: saved-check-decay 2.5s var(--ease-out-expo) both;\n}',
  });
  assert.equal(r.run().status, 1);
  writeFileSync(join(r.dir, 'docs/verify/1937/interaction.webm'), 'x'.repeat(2048));
  r.commit('recording');
  const green = r.run();
  assert.equal(green.status, 0, green.output);
});
