import { describe, expect, it } from 'vitest';
import * as model from '../src/runs/run-items.js';

describe('trace ledger model', () => {
  it('formats the header in the active locale', () => {
    expect(model.formatRunHeader(Date.UTC(2026, 10, 28, 12), 'zh')).toMatch(/2026.*11.*28/);
    expect(model.formatRunHeader(Date.UTC(2026, 10, 28, 12), 'en')).toMatch(/Nov.*28.*2026/);
  });
  it('names a tool call with its own argument so two bash calls read apart', () => {
    expect(model.toolTarget('bash', { command: 'ls docs' })).toBe('bash ls docs');
    expect(model.toolTarget('read', { path: 'CONTRIBUTING.md' })).toBe('read CONTRIBUTING.md');
    expect(model.toolTarget('notify_user', null)).toBe('notify_user');
  });
  it('rejects a foreign run and orders filtered runs chronologically', () => {
    const rows = [
      { id: 'b', kind: 'coordinator', threadId: 't', at: 2, status: 'failed', firstLine: 'second', woke: true },
      { id: 'a', kind: 'coordinator', threadId: 't', at: 1, status: 'done', firstLine: 'first', woke: false },
      { id: 'foreign', kind: 'coordinator', threadId: 'other', at: 3, status: 'done', firstLine: 'first', woke: false },
    ] as any;
    const scope = { kind: 'coordinator', threadId: 't' } as const;
    expect(model.selectLedgerRuns(rows, scope, 'all', '').map((r) => r.id)).toEqual(['a', 'b']);
    expect(model.selectLedgerRuns(rows, scope, 'problems', '').map((r) => r.id)).toEqual(['b']);
    expect(model.selectLedgerRuns(rows, scope, 'all', 'first').map((r) => r.id)).toEqual(['a']);
    expect(model.scopedRunId(rows, scope, 'foreign')).toBeNull();
  });
});
