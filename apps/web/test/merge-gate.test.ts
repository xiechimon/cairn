import { describe, expect, it } from 'vitest';
import { MERGE_GATE_TOOLS, missingMergeTools } from '../src/detail/merge-gate.js';

describe('missingMergeTools', () => {
  it('unknown authorization (null / undefined) does not block — same policy as the server-side gate: unverifiable passes', () => {
    expect(missingMergeTools(null)).toEqual([]);
    expect(missingMergeTools(undefined)).toEqual([]);
  });

  it('both items on reports nothing missing', () => {
    expect(missingMergeTools([...MERGE_GATE_TOOLS])).toEqual([]);
    expect(missingMergeTools(['远程 shell', '合并分支', '推送分支', '创建标签'])).toEqual([]);
  });

  it('empty array still reports both — explicit all-off = zero authorizations, same judgment as the server-side gate (no empty-set exemption)', () => {
    expect(missingMergeTools([])).toEqual(['合并分支', '推送分支']);
  });

  it('non-empty but containing neither item reports both, order = MERGE_GATE_TOOLS order (merge branch first)', () => {
    expect(missingMergeTools(['远程 shell'])).toEqual(['合并分支', '推送分支']);
  });

  it('missing only the push branch reports only the push branch', () => {
    expect(missingMergeTools(['合并分支'])).toEqual(['推送分支']);
  });

  it('missing only the merge branch reports only the merge branch', () => {
    expect(missingMergeTools(['推送分支'])).toEqual(['合并分支']);
  });

  it('authorization items outside the value domain (skills / secrets etc.) do not count as switches', () => {
    expect(missingMergeTools(['远程 shell', '创建技能', '更新技能', '创建标签'])).toEqual([
      '合并分支',
      '推送分支',
    ]);
  });
});