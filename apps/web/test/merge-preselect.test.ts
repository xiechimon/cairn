import { MERGE_BLOCKERS, type MergeBlockerCode, type MergeReadiness } from '@cairn/shared';
import { describe, expect, it } from 'vitest';
import { mergePreselected } from '../src/detail/merge-gate.js';

function gate(...codes: MergeBlockerCode[]): MergeReadiness {
  return {
    ready: codes.length === 0,
    headSha: 'a'.repeat(40),
    patchDigest: null,
    policy: 'autonomous',
    blockers: codes.map((code) => {
      const meta = MERGE_BLOCKERS.find((b) => b.code === code);
      if (meta === undefined) throw new Error(code);
      return { code, class: meta.class, label: meta.label, detail: [] };
    }),
  };
}

describe('the done dialog preselects the merge only on a green gate', () => {
  it('leaves merge unticked while the gate is paused or otherwise blocked', () => {
    expect(mergePreselected({ hasPr: true, gate: gate('autonomy-paused') })).toBe(false);
    expect(mergePreselected({ hasPr: true, gate: gate('required-check-failed') })).toBe(false);
  });

  it('leaves merge unticked while a PR has no gate verdict yet', () => {
    expect(mergePreselected({ hasPr: true, gate: null })).toBe(false);
  });

  it('ticks merge on a green gate, or when the only blocker is the human merge policy', () => {
    expect(mergePreselected({ hasPr: true, gate: gate() })).toBe(true);
    expect(mergePreselected({ hasPr: true, gate: gate('policy-human') })).toBe(true);
  });

  it('keeps the merge ticked for a build without a PR, which has no gate', () => {
    expect(mergePreselected({ hasPr: false, gate: null })).toBe(true);
  });
});
