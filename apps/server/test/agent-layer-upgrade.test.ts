import { join } from 'node:path';
import Database from 'better-sqlite3';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { openDbWithHandle } from '../src/db/client.js';
import { migrateUpTo } from './migrate-helpers.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) releaseTestTempDir(dir);
});

function ancientDb(prefix: string): { dir: string; path: string } {
  const dir = makeTestTempDir(prefix);
  dirs.push(dir);
  const path = join(dir, 'server.db');
  const sqlite = new Database(path);
  try {
    sqlite.pragma('foreign_keys = ON');
    migrateUpTo(sqlite, dir, '0119_agent_layer_backup');
    sqlite.exec(
      "INSERT INTO user (id, displayName) VALUES ('u', 'Owner');" +
        "INSERT INTO team (id, name, createdAt) VALUES ('t', 'T', 1);" +
        "INSERT INTO project (id, name, teamId) VALUES ('p', 'P', 't');",
    );
  } finally {
    sqlite.close();
  }
  return { dir, path };
}

function exec(path: string, statements: string): void {
  const sqlite = new Database(path);
  try {
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(statements);
  } finally {
    sqlite.close();
  }
}

function tableNames(path: string): string[] {
  const sqlite = new Database(path, { readonly: true });
  try {
    return sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => (row as { name: string }).name);
  } finally {
    sqlite.close();
  }
}

describe('agent-layer upgrade bridge', () => {
  test('a release DB with config-less seeded agents upgrades without overflow', () => {
    const { path } = ancientDb('agent-upgrade-seeded-');
    exec(
      path,
      'INSERT INTO agent (id, teamId, displayName, persona) VALUES' +
        "('a1', 't', 'Planner', 'planner'), ('a2', 't', 'Implementer', 'implementer')," +
        "('a3', 't', 'CodeReviewer', 'code_reviewer'), ('a4', 't', 'Verifier', 'verifier');",
    );
    const { db, close } = openDbWithHandle(path);
    expect(tableNames(path)).not.toContain('agent');
    expect(
      db.all<{ id: string }>(sql`SELECT id FROM data_migration WHERE id = 'drop-agents'`),
    ).toHaveLength(1);
    close();
  });

  test('a configured chief agent becomes the coordinator routing rule', () => {
    const { path } = ancientDb('agent-upgrade-chief-');
    exec(
      path,
      'INSERT INTO agent (id, teamId, displayName, provider, modelId, mcpServers) VALUES' +
        "('chief-agent', 't', 'Chief', 'claude-code', 'claude-sonnet-5-5', '[\"github\"]');" +
        "INSERT INTO chief (id, userId, teamId, agentId, createdAt) VALUES ('c', 'u', 't', 'chief-agent', 1);",
    );
    const { db, close } = openDbWithHandle(path);
    const rule = db
      .all<{ provider: string; modelId: string; seededFromAgentId: string }>(
        sql`SELECT provider, modelId, seededFromAgentId FROM routing_rule WHERE teamId = 't' AND use = 'coordinator'`,
      )
      .at(0);
    expect(rule).toMatchObject({
      provider: 'claude-code',
      modelId: 'claude-sonnet-5-5',
      seededFromAgentId: 'chief-agent',
    });
    close();
  });

  test('an assigned reviewer becomes a review rule and its memory is rekeyed', () => {
    const { path } = ancientDb('agent-upgrade-review-');
    exec(
      path,
      'INSERT INTO agent (id, teamId, displayName, provider, modelId, persona) VALUES' +
        "('builder', 't', 'Implementer', 'claude-code', 'claude-sonnet-5-5', 'implementer')," +
        "('reviewer', 't', 'CodeReviewer', 'openai', 'gpt-6.1-sol', 'code_reviewer');" +
        'INSERT INTO todo (id, teamId, projectId, title, phaseAt, seqNum, assignment) VALUES' +
        "('task', 't', 'p', 'Task', 1, 1, '{\"review\":{\"agentId\":\"reviewer\"}}');" +
        'INSERT INTO agent_memory (id, agentId, teamId, title, content, createdAt, updatedAt) VALUES' +
        "('m', 'reviewer', 't', 'Note', 'Body', 1, 1);",
    );
    const { db, close } = openDbWithHandle(path);
    const review = db
      .all<{ id: string; modelId: string }>(
        sql`SELECT id, modelId FROM routing_rule WHERE teamId = 't' AND use = 'review'`,
      )
      .at(0);
    expect(review?.modelId).toBe('gpt-6.1-sol');
    const memory = db
      .all<{ agentId: string; independent: number }>(
        sql`SELECT agentId, independent FROM agent_memory WHERE id = 'm'`,
      )
      .at(0);
    expect(memory?.agentId).toBe(review?.id);
    expect(memory?.independent).toBe(1);
    close();
  });

  test('re-opening an upgraded database skips the bridge and keeps rules stable', () => {
    const { path } = ancientDb('agent-upgrade-reopen-');
    exec(
      path,
      'INSERT INTO agent (id, teamId, displayName, provider, modelId) VALUES' +
        "('chief-agent', 't', 'Chief', 'claude-code', 'claude-sonnet-5-5');" +
        "INSERT INTO chief (id, userId, teamId, agentId, createdAt) VALUES ('c', 'u', 't', 'chief-agent', 1);",
    );
    const first = openDbWithHandle(path);
    const before = first.db.all<{ id: string }>(sql`SELECT id FROM routing_rule`).length;
    first.close();
    const second = openDbWithHandle(path);
    const after = second.db.all<{ id: string }>(sql`SELECT id FROM routing_rule`).length;
    expect(after).toBe(before);
    expect(tableNames(path)).not.toContain('agent');
    second.close();
  });
});
