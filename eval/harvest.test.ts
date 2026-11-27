import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import BetterSqlite from 'better-sqlite3';
import { afterAll, describe, expect, it } from 'vitest';
import type {
  captureClaimInputs,
  existingTurnCapture,
} from '../apps/server/src/services/coordinator-turn-capture.js';
import { cleanupTestTempDirs, makeTestTempDir } from '../scripts/test-tmpdir.mjs';

type ClaimView = Parameters<typeof captureClaimInputs>[1];
type ToolView = NonNullable<ReturnType<typeof existingTurnCapture>>['views'][number];

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HARVEST = join(ROOT, 'eval', 'harvest.ts');

afterAll(cleanupTestTempDirs);

describe('eval/harvest', () => {
  it('turns a sealed claim-shaped snapshot row into one dataset item', () => {
    const dir = makeTestTempDir('cairn-harvest-');
    const dbPath = join(dir, 'snapshots.db');
    const outPath = join(dir, 'items.jsonl');
    const db = new BetterSqlite(dbPath);
    db.exec(`CREATE TABLE coordinator_turn_snapshot (
      turnId TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      capturedAt INTEGER NOT NULL,
      payload TEXT
    )`);
    const secret = `sk-${'A'.repeat(24)}`;
    const claim: ClaimView = {
      systemPrompt: 'coordinator system prompt',
      instruction: `harvest this request into the suite ${secret}`,
      trigger: 'user',
      memories: ['memory note'],
      provider: 'stub',
      modelId: 'model-x',
      thinkingLevel: null,
      volatileText: null,
      projects: [
        { id: 'p1', name: 'docs', description: null, repoKind: null, archivedAt: null },
        { id: 'p2', name: 'ops', description: 'ops repo', repoKind: 'git', archivedAt: null },
      ],
      initialTodos: [],
      initialThreads: [],
      initialVisible: [],
    };
    const toolViews: ToolView[] = [
      { callId: 'call-1', tool: 'projects', params: {}, preCallTodos: [], result: [] },
    ];
    const insert = db.prepare(
      `INSERT INTO coordinator_turn_snapshot (turnId, status, capturedAt, payload) VALUES (?, ?, ?, ?)`,
    );
    insert.run('TURN_Claimed_0001', 'sealed', 200, JSON.stringify({ claim, toolViews }));
    insert.run('turn-no-claim-02', 'sealed', 100, JSON.stringify({ claim: null, toolViews: [] }));
    insert.run('turn-unusable-03', 'unusable', 300, null);
    db.close();

    const run = spawnSync(process.execPath, ['--import', 'tsx', HARVEST], {
      cwd: ROOT,
      env: { ...process.env, HARVEST_DB: dbPath, HARVEST_OUT: outPath, HARVEST_UPLOAD: '0' },
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(run.status, run.stderr || String(run.error)).toBe(0);
    const items = readFileSync(outPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('harvest-turn-claimed-0001');
    expect(items[0].input.request).toBe('harvest this request into the suite [REDACTED]');
    expect(items[0].input.request).not.toContain(secret);
    expect(items[0].input.world.projects).toEqual(['docs', 'ops']);
    expect(items[0].input.gate).toBe(false);
  });
});
