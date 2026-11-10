import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { SESSION_REWORK_BRIEF } from '@cairn/shared';
import Database from 'better-sqlite3';
import { expect, test } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { MIGRATIONS_FOLDER } from '../src/db/client.js';
import { buildCiFixPrompt, buildMergeConflictPrompt } from '../src/services/ci-loop.js';
import { migrateAll, migrateUpTo } from './migrate-helpers.js';

const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8')) as {
  entries: { idx: number; tag: string; when: number }[];
};

test('the upgrade labels stored ci-fix, merge-conflict and rework steps so their prompts fold', () => {
  const directory = makeTestTempDir('cairn-step-prompt-origin-');
  const sqlite = new Database(join(directory, 'db.sqlite'));
  try {
    const cut = journal.entries.findIndex((entry) => entry.tag.endsWith('_step_prompt_origin'));
    const previous = journal.entries[cut - 1];
    if (previous === undefined) throw new Error('the step prompt origin migration has no base');
    migrateUpTo(sqlite, directory, previous.tag);
    const insert = sqlite.prepare(
      "INSERT INTO step (id, buildId, kind, status, prompt, createdAt) VALUES (?, 'build', 'session', 'done', ?, 1)",
    );
    insert.run(
      'prepush',
      '[ci-fix] Local pre-push hook rejected the closing push (round 2/3).\n\n[prepush] node scripts/a.mjs\nexit 1',
    );
    insert.run(
      'prepush-pr',
      buildCiFixPrompt({
        prNumber: 12,
        prUrl: null,
        round: 1,
        failures: [{ name: 'local pre-push hook', conclusion: 'failure', summary: null }],
      }),
    );
    insert.run(
      'checks',
      buildCiFixPrompt({
        prNumber: 12,
        prUrl: 'https://github.com/o/r/pull/12',
        round: 3,
        failures: [{ name: 'lint', conclusion: 'failure', summary: 'a/b: 2 errors' }],
      }),
    );
    insert.run(
      'conflict',
      buildMergeConflictPrompt({ prNumber: 12, prUrl: null, defaultBranch: 'main', round: 2 }),
    );
    insert.run('rework', `${SESSION_REWORK_BRIEF}\n\n哪个分支`);
    insert.run('owner', '[ci-fix] 这一轮为什么失败');
    insert.run('none', null);
    migrateAll(sqlite);
    const origins = Object.fromEntries(
      (
        sqlite.prepare('SELECT id, promptOrigin FROM step ORDER BY id').all() as {
          id: string;
          promptOrigin: string | null;
        }[]
      ).map((row) => [row.id, row.promptOrigin === null ? null : JSON.parse(row.promptOrigin)]),
    );
    expect(origins).toEqual({
      checks: { kind: 'ci-fix', trigger: 'ci-checks', round: 3, roundsMax: 3 },
      conflict: { kind: 'merge-conflict', round: 2, roundsMax: 2 },
      none: null,
      owner: null,
      prepush: { kind: 'ci-fix', trigger: 'pre-push', round: 2, roundsMax: 3 },
      'prepush-pr': { kind: 'ci-fix', trigger: 'pre-push', round: 1, roundsMax: 3 },
      rework: { kind: 'rework' },
    });
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
