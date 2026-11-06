import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { Db } from '../../../src/legacy/agent-layer/db.js';
import { agentForStep } from '../../../src/legacy/agent-layer/dispatch-eligibility.js';
import { runRoutingMigration } from '../../../src/legacy/agent-layer/routing-migration.js';
import {
  memoryOwnerOf,
  setRoutingRulesEnabled,
} from '../../../src/legacy/agent-layer/routing-rules.js';
import * as schema from '../../../src/legacy/agent-layer/schema.js';

export interface OracleProfile {
  provider: string | null;
  modelId: string | null;
  thinkingLevel: string | null;
  machineId: string | null;
  tools: string[];
  secrets: string[];
  mcpServers: string[];
  skillsAllowlist: string[] | null;
  defaultSkill: string | null;
  requiredCapabilities: unknown;
  fallbackModels: unknown;
}

export interface LegacyOracle {
  profile(
    todoId: string,
    kind: 'build' | 'plan' | 'verify' | 'review',
    reviewerAgentId: string | null,
  ): OracleProfile | null;
  memoryOwner(
    teamId: string,
    agentId: string,
    kind: 'build' | 'plan' | 'verify' | 'review',
  ): string;
  close(): void;
}

export function openLegacyOracle(dbPath: string): LegacyOracle {
  const sqlite = new Database(dbPath);
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('synchronous = OFF');
  sqlite.pragma('journal_mode = MEMORY');
  const db: Db = drizzle(sqlite, { schema });
  runRoutingMigration(db);
  setRoutingRulesEnabled(true);
  return {
    profile(todoId, kind, reviewerAgentId) {
      const todoRow = db.select().from(schema.todo).where(eq(schema.todo.id, todoId)).get();
      if (todoRow === undefined) throw new Error(`legacy todo ${todoId} missing`);
      const prompt =
        kind === 'review' && reviewerAgentId !== null
          ? `${JSON.stringify({ kind: 'review', agentId: reviewerAgentId })}\n`
          : null;
      const row = agentForStep(db, todoRow, kind, prompt);
      if (row === null) return null;
      return {
        provider: row.provider,
        modelId: row.modelId,
        thinkingLevel: row.thinkingLevel,
        machineId: row.machineId,
        tools: row.tools,
        secrets: row.secrets,
        mcpServers: row.mcpServers,
        skillsAllowlist: row.skillsAllowlist,
        defaultSkill: row.defaultSkill,
        requiredCapabilities: row.requiredCapabilities,
        fallbackModels: row.fallbackModels,
      };
    },
    memoryOwner(teamId, agentId, kind) {
      return memoryOwnerOf(db, teamId, agentId, kind);
    },
    close() {
      setRoutingRulesEnabled(false);
      sqlite.close();
    },
  };
}
