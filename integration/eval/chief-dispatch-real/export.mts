#!/usr/bin/env -S pnpm exec tsx
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parseOrchestrationSourceRef, redactSecrets } from '@cairn/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../apps/server/src/db/schema.js';
import {
  agent,
  build,
  chiefMessage,
  project,
  step,
  todo,
} from '../../../apps/server/src/db/schema.js';
import { extractText } from '../../../apps/server/src/services/chief.js';
import type { DispatchOutcome, ExportedDispatchCase, SnapshotProject } from './types.mts';

export class DispatchExportError extends Error {}

type SqliteDatabase = {
  close(): void;
};

type SqliteDatabaseCtor = new (
  filename: string,
  options?: { readonly?: boolean; fileMustExist?: boolean },
) => SqliteDatabase;

const Database = createRequire(
  join(fileURLToPath(new URL('../../..', import.meta.url)), 'apps/server/package.json'),
)('better-sqlite3') as SqliteDatabaseCtor;

function agentKey(displayName: string, id: string): string {
  const slug = displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return slug.length > 0 ? slug : id.slice(0, 8);
}

function promptFromThread(
  db: ReturnType<typeof drizzle<typeof schema>>,
  threadId: string,
): string | null {
  const rows = db
    .select()
    .from(chiefMessage)
    .where(and(eq(chiefMessage.threadId, threadId), eq(chiefMessage.role, 'user')))
    .orderBy(asc(chiefMessage.createdAt))
    .all();
  for (const row of rows) {
    const text = extractText(row.content);
    if (text !== null && text.trim() !== '') return text.trim();
  }
  return null;
}

function classifyOutcome(args: {
  phase: string;
  chiefBuildIds: string[];
  builds: Array<{
    id: string;
    triggerSource: string;
    createdAt: number;
    errorMessage: string | null;
  }>;
  steps: Array<{ buildId: string; status: string }>;
}): DispatchOutcome | null {
  const chiefSteps = args.steps.filter((s) => args.chiefBuildIds.includes(s.buildId));
  if (args.phase === 'failed' || chiefSteps.some((s) => s.status === 'failed')) return 'failed';
  const chiefBuilds = args.builds.filter((b) => args.chiefBuildIds.includes(b.id));
  if (
    args.phase === 'closed' ||
    chiefSteps.some((s) => s.status === 'stopped') ||
    chiefBuilds.some(
      (b) => b.errorMessage !== null && /stopped|cancelled|canceled/i.test(b.errorMessage),
    )
  ) {
    return 'cancelled';
  }
  const firstChiefAt = Math.min(...chiefBuilds.map((b) => b.createdAt));
  if (args.builds.some((b) => b.triggerSource !== 'chief' && b.createdAt > firstChiefAt)) {
    return 'reassigned';
  }
  return null;
}

export function exportDispatchFailures(dbPath: string): ExportedDispatchCase[] {
  const sqlite = new Database(dbPath, { readonly: true, fileMustExist: true });
  const db = drizzle(sqlite as never, { schema });
  try {
    const chiefBuilds = db
      .select()
      .from(build)
      .where(eq(build.triggerSource, 'chief'))
      .orderBy(asc(build.createdAt), asc(build.id))
      .all();
    if (chiefBuilds.length === 0) return [];
    const todoIds = [...new Set(chiefBuilds.map((b) => b.todoId))];
    const todos = db.select().from(todo).where(inArray(todo.id, todoIds)).all();
    const allBuilds = db
      .select()
      .from(build)
      .where(inArray(build.todoId, todoIds))
      .orderBy(asc(build.createdAt), asc(build.id))
      .all();
    const buildIds = allBuilds.map((b) => b.id);
    const steps =
      buildIds.length === 0
        ? []
        : db.select().from(step).where(inArray(step.buildId, buildIds)).all();
    const teamIds = [...new Set(todos.map((t) => t.teamId))];
    const projects =
      teamIds.length === 0
        ? []
        : db.select().from(project).where(inArray(project.teamId, teamIds)).all();
    const agents =
      teamIds.length === 0
        ? []
        : db.select().from(agent).where(inArray(agent.teamId, teamIds)).all();

    const snapshotByTeam = new Map<string, SnapshotProject[]>();
    for (const teamId of teamIds) {
      const teamProjects = projects.filter((p) => p.teamId === teamId);
      const teamAgents = agents.filter((a) => a.teamId === teamId);
      snapshotByTeam.set(
        teamId,
        teamProjects.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description ?? p.githubRepo ?? '',
          agents: teamAgents.map((a) => ({
            id: a.id,
            key: agentKey(a.displayName, a.id),
            displayName: a.displayName,
            description: a.description ?? '',
          })),
        })),
      );
    }

    const out: ExportedDispatchCase[] = [];
    for (const task of todos) {
      const taskBuilds = allBuilds.filter((b) => b.todoId === task.id);
      const chiefForTask = taskBuilds.filter((b) => b.triggerSource === 'chief');
      if (chiefForTask.length === 0) continue;
      const outcome = classifyOutcome({
        phase: task.phase,
        chiefBuildIds: chiefForTask.map((b) => b.id),
        builds: taskBuilds,
        steps: steps.filter((s) => taskBuilds.some((b) => b.id === s.buildId)),
      });
      if (outcome === null) continue;

      let prompt: string | null = null;
      if (task.sourceKind === 'orchestration' && task.sourceRef !== null) {
        const parsed = parseOrchestrationSourceRef(task.sourceRef);
        if (parsed !== null) prompt = promptFromThread(db, parsed.threadId);
      }
      if (prompt === null || prompt === '') {
        prompt = task.spec.trim() !== '' ? task.spec : task.title;
      }

      const assignedId = task.assignment?.build?.agentId ?? task.assignment?.plan?.agentId ?? null;
      const assigned = assignedId === null ? null : agents.find((a) => a.id === assignedId);
      out.push({
        caseId: task.id,
        prompt,
        projectsSnapshot: snapshotByTeam.get(task.teamId) ?? [],
        dispatchedTo:
          assigned === undefined || assigned === null
            ? null
            : {
                agentId: assigned.id,
                displayName: assigned.displayName,
                key: agentKey(assigned.displayName, assigned.id),
              },
        outcome,
      });
    }
    return out;
  } finally {
    sqlite.close();
  }
}

function main() {
  const { values } = parseArgs({
    options: {
      db: { type: 'string' },
      out: { type: 'string' },
    },
  });
  if (!values.db || !values.out) {
    console.error('usage: export.mts --db <server.db> --out <raw.json>');
    process.exit(2);
  }
  const dbPath = resolve(values.db);
  const outPath = resolve(values.out);
  const cases = exportDispatchFailures(dbPath);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(
    outPath,
    `${JSON.stringify({ exportedAt: new Date().toISOString(), cases }, null, 2)}\n`,
    {
      mode: 0o600,
    },
  );
  console.log(
    `exported=${cases.length} out=${redactSecrets(outPath).value} outcomes=${JSON.stringify(
      cases.reduce(
        (acc, c) => {
          acc[c.outcome] = (acc[c.outcome] ?? 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      ),
    )}`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    main();
  } catch (error) {
    console.error(
      `Dispatch export failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
