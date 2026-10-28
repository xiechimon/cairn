import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type Candidate,
  type QualificationRun,
  qualifyMemoryCases,
  verifyRun,
} from './check-qualification.mts';

const cases: Candidate[] = ['adjacent', 'irrelevant'].flatMap((kind) =>
  Array.from({ length: 4 }, (_, i) => ({
    id: `${kind === 'adjacent' ? 'a' : 'i'}${i + 1}`,
    kind: kind as Candidate['kind'],
    fingerprint: `${kind}-${i}`,
  })),
);
function row(id: string, decision = 0, untouched = 1) {
  return {
    prompt_id: id,
    rep: 0,
    status: 'ok',
    model: 'glm-5.3',
    meta: { context_window: 1_000_000 },
    usage: { input_tokens: 100, output_tokens: 50 },
    grade: { decision_ok: decision, untouched_ok: untouched },
  };
}
function run(over: Partial<QualificationRun> = {}): QualificationRun {
  return {
    model: 'glm-5.3',
    contextWindow: 1_000_000,
    cases,
    withMemory: cases.map((c) => row(c.id)),
    withoutMemory: cases.filter((c) => c.kind === 'irrelevant').map((c) => row(c.id, 1)),
    errors: [],
    ...over,
  };
}
const qualify = (runs: QualificationRun[]) => qualifyMemoryCases(cases, ['glm-5.3'], runs);

test('completed baseline failures and paired controls qualify both families', () => {
  assert.equal(qualify([run()]).ready, true);
});
test('all-pass cases do not qualify', () => {
  const result = qualify([run({ withMemory: cases.map((c) => row(c.id, 1)) })]);
  assert.equal(result.ready, false);
  assert.equal(result.cases.filter((c) => c.qualified).length, 0);
});
test('harness errors cannot supply qualifying failures', () => {
  const result = qualify([run({ withMemory: [], errors: cases.map((c) => row(c.id)) })]);
  assert.equal(result.ready, false);
  assert.equal(result.cases.filter((c) => c.qualified).length, 0);
});
test('a preservation failure qualifies an adjacent case independently of decision', () => {
  const result = qualify([run({ withMemory: cases.map((c) => row(c.id, 1, 0)) })]);
  assert.equal(result.cases.find((c) => c.id === 'a1')?.qualified, true);
  assert.equal(result.cases.find((c) => c.id === 'i1')?.qualified, false);
});
test('missing no-memory controls keep the delivery incomplete', () => {
  assert.equal(qualify([run({ withoutMemory: [] })]).ready, false);
});
test('a changed case cannot inherit old qualification', () => {
  const changed = cases.map((c) => (c.id === 'a1' ? { ...c, fingerprint: 'changed' } : c));
  const result = qualifyMemoryCases(changed, ['glm-5.3'], [run()]);
  assert.equal(result.cases.find((c) => c.id === 'a1')?.qualified, false);
  assert.equal(result.ready, false);
});
test('duplicate repetitions are rejected', () => {
  assert.throws(
    () => qualify([run({ withMemory: [...cases.map((c) => row(c.id)), row('a1')] })]),
    /Duplicate repetition/,
  );
});
test('an unlisted requested model is rejected', () => {
  assert.throws(
    () => qualify([run({ model: 'other-model' })]),
    /Model is outside the current roster/,
  );
});
test('served-model substitution is rejected', () => {
  const rows = cases.map((c) => ({ ...row(c.id), model: 'other-model' }));
  assert.throws(() => qualify([run({ withMemory: rows })]), /Served model differs/);
});
test('truncated or zero-usage rows cannot qualify', () => {
  for (const mutation of [
    { status: 'truncated' },
    { usage: { input_tokens: 0, output_tokens: 0 } },
  ]) {
    assert.throws(
      () => qualify([run({ withMemory: cases.map((c) => ({ ...row(c.id), ...mutation })) })]),
      /Incomplete scored row/,
    );
  }
});
test('missing repetitions or required grades are rejected', () => {
  for (const mutation of [{ rep: undefined }, { grade: {} }]) {
    assert.throws(
      () => qualify([run({ withMemory: cases.map((c) => ({ ...row(c.id), ...mutation })) })]),
      /Invalid repetition|Missing binary grade/,
    );
  }
});

test('error-classified rows cannot be moved into scored results', () => {
  const rows = cases.map((c) => ({ ...row(c.id), failure_class: 'harness_error' }));
  assert.throws(() => qualify([run({ withMemory: rows })]), /Incomplete scored row/);
});
test('fixture provenance is rejected before source artifacts are inspected', () => {
  const home = mkdtempSync(join(tmpdir(), 'qualification-fixture-'));
  try {
    writeFileSync(
      join(home, 'input-manifest.json'),
      JSON.stringify({ providerMode: 'fixture', sourceCommit: '0'.repeat(40) }),
    );
    assert.throws(() => verifyRun(home), /Real-provider provenance is missing/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('a configured window below 1M cannot qualify', () => {
  assert.throws(
    () => qualify([run({ contextWindow: 128_000 })]),
    /1M execution metadata is missing/,
  );
});
test('scored rows must record the same window as their run', () => {
  for (const meta of [undefined, { context_window: 128_000 }]) {
    const rows = cases.map((c) => ({ ...row(c.id), meta }));
    assert.throws(() => qualify([run({ withMemory: rows })]), /Incomplete scored row/);
  }
});
