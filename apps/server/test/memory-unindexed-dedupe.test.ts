import { join } from 'node:path';
import { expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { openDbWithHandle } from '../src/db/client.js';
import { agentMemory } from '../src/db/schema.js';
import { injectMemoryDocuments } from '../src/services/memory.js';
import {
  appendMemoryIndex,
  executeMemoryDocumentTool,
  rememberMemoryFile,
} from '../src/services/memory-documents.js';

const cases = (['append', 'remember'] as const).flatMap((path) =>
  ['same fact', 'same\nmultiline fact'].flatMap((detail) =>
    [
      '',
      Array(200).fill('existing').join('\n'),
      'x'.repeat(25 * 1024),
      '- [old label](standalone%20file.md)',
    ].map((initial) => ({ path, detail, initial })),
  ),
);

test.each(cases)(
  '$path reuses matching $detail with index $initial.length',
  ({ path, detail, initial }) => {
    const dir = makeTestTempDir('unindexed-dedupe-');
    let opened = openDbWithHandle(join(dir, 'memory.sqlite'));
    try {
      const owner = { teamId: `${detail}-${initial.length}`, agentId: 'agent', projectId: null };
      const saved = executeMemoryDocumentTool(opened.db, owner, 'save_memory', {
        scope: 'team',
        file: 'standalone file.md',
        content: detail,
      }) as { id: string };
      const readIndex = () =>
        executeMemoryDocumentTool(opened.db, owner, 'memories', {
          scope: 'team',
          file: 'MEMORY.md',
        }) as { baseVersion: string; content: string };
      executeMemoryDocumentTool(opened.db, owner, 'update_memory', {
        scope: 'team',
        file: 'MEMORY.md',
        baseVersion: readIndex().baseVersion,
        content: initial,
      });
      const write = () =>
        path === 'append'
          ? appendMemoryIndex(opened.db, owner, 'another title', detail)
          : rememberMemoryFile(opened.db, owner, 'another title', detail);
      const before = opened.db.select().from(agentMemory).all();
      const result = write();
      const injected = injectMemoryDocuments(opened.db, { ...owner, recordUse: false });
      expect(injected.memories[0]!.content).toContain('](standalone%20file.md)');
      expect(result).toEqual(
        path === 'append'
          ? !initial.includes('](standalone%20file.md)')
          : expect.objectContaining({ id: saved.id }),
      );
      const rows = opened.db.select().from(agentMemory).all();
      if (initial.includes('](standalone%20file.md)')) expect(rows).toEqual(before);
      expect(rows.find((row) => row.layer === 'core' && row.invalidAt === null)!.content).toContain(
        initial,
      );
      expect(rows.filter((row) => row.layer === 'searchable')).toEqual(
        before.filter((row) => row.layer === 'searchable'),
      );
      const version = readIndex().baseVersion;
      const repeated = write();
      expect(repeated).toEqual(
        path === 'append' ? false : expect.objectContaining({ id: saved.id }),
      );
      expect(readIndex().baseVersion).toBe(version);
      expect(opened.db.select().from(agentMemory).all()).toEqual(rows);
      opened.close();
      opened = openDbWithHandle(join(dir, 'memory.sqlite'));
      expect(
        injectMemoryDocuments(opened.db, { ...owner, recordUse: false }).memories[0]!.content,
      ).toContain('](standalone%20file.md)');
    } finally {
      opened.close();
      releaseTestTempDir(dir);
    }
  },
);
