import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { makeTestTempDir, releaseTestTempDir } from './test-tmpdir.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const SCRIPT = join(ROOT, 'scripts', 'generate-canon.mjs');
const DOC = join(ROOT, 'docs', 'CANON.md');
const REGISTRY = join(ROOT, 'docs', 'canon', 'rulings.json');

test('canon digest is in step with the rulings registry', () => {
  const out = execFileSync('node', [SCRIPT, '--check'], { cwd: ROOT, encoding: 'utf8' });
  assert.match(out, /up to date/);
});

test('registry rulings are unique, dated and point at real specs', () => {
  const { rulings } = JSON.parse(readFileSync(REGISTRY, 'utf8'));
  const ids = new Set();
  for (const r of rulings) {
    assert.ok(!ids.has(r.id), `duplicate id ${r.id}`);
    ids.add(r.id);
    assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/, r.id);
    assert.ok(r.ruling.length > 20, r.id);
    assert.ok(r.spec.startsWith('docs/spec/'), r.id);
  }
  const doc = readFileSync(DOC, 'utf8');
  for (const r of rulings) assert.ok(doc.includes(r.id), `${DOC} missing ${r.id}`);
});

test('check mode fails when the digest is stale', (t) => {
  const sandbox = makeTestTempDir('canon-');
  t.after(() => releaseTestTempDir(sandbox));
  execFileSync('mkdir', ['-p', join(sandbox, 'docs', 'canon'), join(sandbox, 'docs', 'spec')]);
  execFileSync('cp', [SCRIPT, join(sandbox, 'generate-canon.mjs')]);
  execFileSync('cp', [DOC, join(sandbox, 'docs', 'CANON.md')]);
  writeFileSync(join(sandbox, 'docs', 'spec', '18-positioning-and-differentiation.md'), '# stub\n');
  const registry = JSON.parse(readFileSync(REGISTRY, 'utf8'));
  registry.rulings = registry.rulings.filter((r) => r.spec.includes('18-'));
  registry.rulings.push({
    id: 'sandbox.stale',
    date: '2026-01-01',
    ruling: 'A sandbox ruling that never landed in the digest file.',
    spec: 'docs/spec/18-positioning-and-differentiation.md',
    section: '§1',
  });
  writeFileSync(join(sandbox, 'docs', 'canon', 'rulings.json'), JSON.stringify(registry));
  let failed = false;
  try {
    execFileSync('node', [join(sandbox, 'generate-canon.mjs'), '--check'], {
      cwd: sandbox,
      stdio: 'pipe',
    });
  } catch {
    failed = true;
  }
  assert.equal(failed, true, 'stale digest must fail --check');
});
