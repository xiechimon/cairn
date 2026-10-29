import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { createEphemeralSecretBox } from '../../apps/server/src/lib/secret-box.js';
import { runHeldOut } from '../eval/chief-dispatch-real/run-heldout.mts';
import {
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

  test('the runner invokes the evaluator and stdout contains no case prompt text', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-dispatch-real-heldout-'));
    dirs.push(dir);
    const box = createEphemeralSecretBox();
    const { visible, heldOut } = splitLabeledCases(SAMPLE);
    writeVisibleFlow(visible, join(dir, 'visible'));
    const sealedPath = join(dir, 'heldout.sealed');
    sealHeldOutCases(heldOut, box, sealedPath);
    let evaluatedFlow: string | null = null;
    const result = await runHeldOut({
      sealedPath,
      box,
      evaluate: async (flowDir) => {
        evaluatedFlow = flowDir;
        const flow = JSON.parse(readFileSync(join(flowDir, 'cases.json'), 'utf8')) as {
          cases: Array<{ id: string; prompt: string }>;
        };
        expect(flow.cases.length).toBe(heldOut.length);
        const lines = flow.cases.map((c, i) =>
          JSON.stringify({
            prompt_id: c.id,
            rep: 1,
            grade: { decision_ok: i < Math.ceil(flow.cases.length / 2) ? 1 : 0 },
          }),
        );
        const { mkdirSync } = await import('node:fs');
        mkdirSync(join(flowDir, 'baseline'), { recursive: true });
        const resultsPath = join(flowDir, 'baseline', 'results.jsonl');
        writeFileSync(resultsPath, `${lines.join('\n')}\n`);
        return { resultsJsonlPath: resultsPath };
      },
    });
    expect(evaluatedFlow).not.toBeNull();
    expect(result.scored).toBe(heldOut.length);
    const expectedOk = Math.ceil(heldOut.length / 2) / heldOut.length;
    expect(result.decisionOk).toBeCloseTo(expectedOk, 5);
    expect(result.stdout).toContain('held-out');
    expect(result.stdout).toContain('decision_ok');
    for (const c of heldOut) {
      expect(result.stdout.includes(c.prompt)).toBe(false);
    }
    for (const c of visible) {
      expect(result.stdout.includes(c.prompt)).toBe(false);
    }
  });
});
