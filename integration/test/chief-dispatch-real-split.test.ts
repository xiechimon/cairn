import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { createEphemeralSecretBox } from '../../apps/server/src/lib/secret-box.js';
import {
  formatHeldOutRunStdout,
  openHeldOutCases,
  sealHeldOutCases,
  splitLabeledCases,
  writeVisibleFlow,
} from '../eval/chief-dispatch-real/split.mts';
import type { LabeledDispatchCase } from '../eval/chief-dispatch-real/types.mts';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function labeled(id: string, prompt: string, agent: string): LabeledDispatchCase {
  return {
    id,
    tags: ['dispatch', 'real', agent],
    prompt,
    expect: { kind: 'dispatch', agent },
    roster: [
      {
        key: 'frontend',
        displayName: 'Frontend',
        modelId: 'kimi-k3',
        description: 'UI',
      },
      {
        key: 'code',
        displayName: 'Backend',
        modelId: 'glm-5.3',
        description: 'API',
      },
    ],
  };
}

const SAMPLE: LabeledDispatchCase[] = Array.from({ length: 10 }, (_, i) =>
  labeled(
    `c${i}`,
    `secret prompt text for case ${i} please hide`,
    i % 2 === 0 ? 'frontend' : 'code',
  ),
);

describe('chief-dispatch-real split', () => {
  test('the split is deterministic', () => {
    const a = splitLabeledCases(SAMPLE);
    const b = splitLabeledCases(SAMPLE);
    expect(a.visible.map((c) => c.id)).toEqual(b.visible.map((c) => c.id));
    expect(a.heldOut.map((c) => c.id)).toEqual(b.heldOut.map((c) => c.id));
    expect(a.visible.length + a.heldOut.length).toBe(SAMPLE.length);
    expect(Math.abs(a.visible.length - a.heldOut.length)).toBeLessThanOrEqual(1);
    const ids = new Set([...a.visible, ...a.heldOut].map((c) => c.id));
    expect(ids.size).toBe(SAMPLE.length);
  });

  test('the held-out file on disk is not valid JSON (it is sealed)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-dispatch-real-split-'));
    dirs.push(dir);
    const box = createEphemeralSecretBox();
    const { heldOut } = splitLabeledCases(SAMPLE);
    const sealedPath = join(dir, 'heldout.sealed');
    sealHeldOutCases(heldOut, box, sealedPath);
    const raw = readFileSync(sealedPath, 'utf8');
    expect(() => JSON.parse(raw)).toThrow();
    expect(raw.includes('secret prompt text')).toBe(false);
    const opened = openHeldOutCases(sealedPath, box);
    expect(opened.map((c) => c.id).sort()).toEqual(heldOut.map((c) => c.id).sort());
  });

  test("the runner's stdout for a held-out run contains no case prompt text", () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-dispatch-real-heldout-'));
    dirs.push(dir);
    const box = createEphemeralSecretBox();
    const { visible, heldOut } = splitLabeledCases(SAMPLE);
    writeVisibleFlow(visible, join(dir, 'visible'));
    const sealedPath = join(dir, 'heldout.sealed');
    sealHeldOutCases(heldOut, box, sealedPath);
    const opened = openHeldOutCases(sealedPath, box);
    const stdout = formatHeldOutRunStdout({
      half: 'held-out',
      caseCount: opened.length,
      decisionOk: 0.5,
      decisionOkInterval: [0.2, 0.8],
      scored: opened.length,
    });
    writeFileSync(join(dir, 'stdout.txt'), stdout);
    expect(stdout).toContain('held-out');
    expect(stdout).toContain('decision_ok');
    for (const c of opened) {
      expect(stdout.includes(c.prompt)).toBe(false);
    }
    for (const c of visible) {
      expect(stdout.includes(c.prompt)).toBe(false);
    }
  });
});
