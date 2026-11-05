import type { DocumentDiffFile } from '@cairn/shared';
import { describe, expect, it } from 'vitest';
import { type BuildChangesQuery, deriveThreadChanges } from '../src/board/thread-changes.js';
import type { ChangesContent } from '../src/fixtures/records.js';

const file = (path: string, additions: number, deletions: number): DocumentDiffFile => ({
  path,
  additions,
  deletions,
  hunks: [],
});

const pending: BuildChangesQuery = { status: 'pending', data: undefined };
const settled = (files: DocumentDiffFile[]): BuildChangesQuery => ({
  status: 'success',
  data: { files, reported: true },
});

const derive = (query: BuildChangesQuery, buildId: string | null = 'b1') =>
  deriveThreadChanges({ live: true, buildId, query, fixture: undefined, expanded: true });

describe('the changes a thread side chat shows', () => {
  it('has none before a build exists', () => {
    expect(derive(pending, null).status).toBe('none');
  });

  it('has none for a build that changed nothing', () => {
    expect(derive(settled([])).status).toBe('none');
  });

  it('is loading while the first fetch runs', () => {
    expect(derive(pending).status).toBe('loading');
  });

  it('is an error when the fetch fails', () => {
    expect(derive({ status: 'error', data: undefined }).status).toBe('error');
  });

  it('counts files and lines across the diff', () => {
    const changes = derive(settled([file('a.ts', 3, 1), file('b.ts', 2, 0)]));
    expect(changes).toMatchObject({ status: 'ready', fileCount: 2, added: 5, removed: 1 });
  });

  it('follows the data when a new build lands', () => {
    const first = derive(settled([file('a.ts', 1, 0)]), 'b1');
    const second = derive(settled([file('a.ts', 4, 2), file('c.ts', 1, 1)]), 'b2');
    expect([first.added, first.removed]).toEqual([1, 0]);
    expect([second.added, second.removed]).toEqual([5, 3]);
  });

  it('keeps the expand choice on the content', () => {
    const changes = deriveThreadChanges({
      live: true,
      buildId: 'b1',
      query: settled([file('a.ts', 1, 0)]),
      fixture: undefined,
      expanded: false,
    });
    expect(changes.content?.expanded).toBe(false);
  });

  it('reads the fixture detail when not live', () => {
    const fixture: ChangesContent = {
      expanded: false,
      files: [{ path: 'x.ts', added: 2, removed: 1, hunks: [] }],
    };
    const changes = deriveThreadChanges({
      live: false,
      buildId: null,
      query: pending,
      fixture,
      expanded: true,
    });
    expect(changes).toMatchObject({ status: 'ready', added: 2, removed: 1 });
    expect(changes.content?.expanded).toBe(true);
  });
});
