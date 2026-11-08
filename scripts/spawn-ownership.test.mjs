import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const ROOT = join(import.meta.dirname, '..');
const HELPER = 'scripts/owned-process.mjs';
const SANDBOXED = {
  'scripts/ops/orb/canary-attacker.mjs':
    'runs inside the canary sandbox, which receives only canary-attacker.mjs and canary-model.mjs; the model it leaves running watches its parent pid and stops itself after 10 minutes',
};
const CODE = /\.(c|m)?(j|t)s$/;
const LAUNCH_DOCS = /\b(nohup|setsid|disown)\b|\S\s+&\s*$/m;

function escapes(source) {
  const found = [];
  if (/\bdetached\s*:(?!\s*false\b)/.test(source)) found.push('detached: <not false>');
  if (/[{,]\s*detached\s*[,}]/.test(source)) found.push('detached shorthand');
  const children = [
    ...source.matchAll(
      /(?:const|let|var)\s+(\w+)\s*=\s*(?:await\s+)?(?:[\w.]+\.)?(?:spawn|fork|exec|execFile)\s*\(/g,
    ),
  ].map((match) => match[1]);
  for (const name of new Set(children))
    if (new RegExp(`\\b${name}\\.unref\\(\\)`).test(source)) found.push(`${name}.unref()`);
  if (/\b(?:spawn|fork)\([^;]*?\)\s*\.unref\(\)/s.test(source)) found.push('spawn(...).unref()');
  return found;
}

function tracked(...paths) {
  return execFileSync('git', ['ls-files', '-z', ...paths], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
}

test('the scanner catches every way a child is cut loose from its owner', () => {
  assert.deepEqual(escapes("spawn('x', [], { detached: true })"), ['detached: <not false>']);
  assert.deepEqual(escapes("spawn('x', [], { stdio, detached })"), ['detached shorthand']);
  assert.deepEqual(escapes("const server = spawn('x');\nserver.unref();"), ['server.unref()']);
  assert.deepEqual(escapes("const c = await child_process.fork('x');\nc.unref();"), ['c.unref()']);
  assert.deepEqual(escapes("spawn('x', ['y']).unref();"), ['spawn(...).unref()']);
  assert.deepEqual(
    escapes("spawn('x', [], { detached: false });\nconst t = setTimeout(f, 1);\nt.unref();"),
    [],
  );
});

test('only the owned-process helper detaches or unrefs a child in scripts and skills', () => {
  const offenders = tracked('scripts', '.claude/skills', '.cursor/skills')
    .filter((path) => CODE.test(path) && !/\.test\.(c|m)?(j|t)s$/.test(path))
    .filter((path) => path !== HELPER && !(path in SANDBOXED))
    .map((path) => [path, escapes(readFileSync(join(ROOT, path), 'utf8'))])
    .filter(([, found]) => found.length > 0);
  assert.deepEqual(
    offenders,
    [],
    'start long-lived children with spawnOwned/runOwned/launchOwnedDetached from scripts/owned-process.mjs',
  );
});

test('the sandboxed exception still needs its exception', () => {
  for (const path of Object.keys(SANDBOXED))
    assert.notDeepEqual(
      escapes(readFileSync(join(ROOT, path), 'utf8')),
      [],
      `${path} no longer needs the exception`,
    );
});

test('skill recipes never background a process with nohup, setsid, disown or a trailing &', () => {
  const offenders = tracked('.claude/skills', '.cursor/skills')
    .filter((path) => path.endsWith('.md') && !path.includes('/changelog/'))
    .filter((path) => LAUNCH_DOCS.test(readFileSync(join(ROOT, path), 'utf8')));
  assert.deepEqual(
    offenders,
    [],
    'run long-lived recipe steps as a background task through scripts/owned-process.mjs',
  );
});
