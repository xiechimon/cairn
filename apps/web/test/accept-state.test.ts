import { describe, expect, it } from 'vitest';
import { acceptState } from '../src/detail/accept-state.js';

const base = { infoOutput: false, substantiveChanges: true, locked: false, missingTools: [] };

describe('acceptState', () => {
  it('merges by default when the agent may merge', () => {
    expect(acceptState({ ...base }, true)).toMatchObject({
      mergeChecked: true,
      mergeDisabled: false,
      confirmDisabled: false,
      permissionMissing: false,
    });
  });

  it('missing merge permission disables only the merge option, finishing stays available', () => {
    const state = acceptState({ ...base, missingTools: ['合并分支'] }, true);
    expect(state.permissionMissing).toBe(true);
    expect(state.mergeChecked).toBe(false);
    expect(state.mergeDisabled).toBe(true);
    expect(state.confirmDisabled).toBe(false);
    expect(state.merge).toBe(false);
  });

  it('a failed task can only finish through a merge, so missing permission blocks it', () => {
    const state = acceptState({ ...base, locked: true, missingTools: ['合并分支'] }, true);
    expect(state.confirmDisabled).toBe(true);
  });

  it('respects the user unchecking merge', () => {
    expect(acceptState({ ...base }, false)).toMatchObject({ mergeChecked: false, merge: false });
  });

  it('skips the merge option when there are no changes or the output is a report', () => {
    expect(acceptState({ ...base, substantiveChanges: false }, true).skipMerge).toBe(true);
    expect(acceptState({ ...base, infoOutput: true, missingTools: ['合并分支'] }, true)).toMatchObject({
      skipMerge: true,
      permissionMissing: false,
      confirmDisabled: false,
    });
  });
});
