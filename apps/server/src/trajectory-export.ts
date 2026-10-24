import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import {
  type BackendRuntimeId,
  CONFIRM_ANNOUNCEMENT,
  MERGE_ANNOUNCEMENT,
  redactSecrets,
  trajectoryPackSchema,
} from '@cairn/shared';
import Database from 'better-sqlite3';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { ServerConfig } from './config.js';
import {
  agent,
  build,
  buildFeedback,
  gateVerdict,
  message,
  plan,
  step,
  todo,
  tokenUsage,
} from './db/schema.js';

export class TrajectoryExportError extends Error {}

const CLAUDE_CODE_PROVIDER: BackendRuntimeId = 'claude-code';

type SkipReason = 'session_missing';

class SkippedBuild extends TrajectoryExportError {
  constructor(readonly reason: SkipReason) {
    super('Step session missing');
  }
}

function readStepSession(path: string) {
  if (!existsSync(path)) throw new SkippedBuild('session_missing');
  const transcript: unknown[] = [];
  const runtimeModels: string[] = [];
  for (const line of readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')) {
    const entry: unknown = JSON.parse(line);
    if (
      typeof entry !== 'object' ||
      entry === null ||
      !('type' in entry) ||
      !['message', 'assistant', 'user', 'system'].includes(String(entry.type)) ||
      !('message' in entry)
    )
      continue;
    const raw = entry.message;
    if (typeof raw !== 'object' || raw === null || !('role' in raw)) {
      transcript.push(raw);
      continue;
    }
    transcript.push(raw.role === 'toolResult' ? { ...raw, role: 'system' } : raw);
    if (raw.role !== 'assistant' || !('model' in raw) || typeof raw.model !== 'string') continue;
    const provider =
      'provider' in raw && typeof raw.provider === 'string'
        ? raw.provider
        : entry.type === 'assistant'
          ? CLAUDE_CODE_PROVIDER
          : undefined;
    if (provider !== undefined) runtimeModels.push(`${provider}/${raw.model}`);
  }
  return { transcript, runtimeModels };
}

export interface TrajectoryExportOptions {
  buildId?: string;
  since?: number;
  until?: number;
  out?: string;
}

export function exportTrajectories(config: ServerConfig, options: TrajectoryExportOptions) {
  const out = resolve(
    options.out ??
      join(config.dataDir, 'trajectory-exports', `${Date.now()}-${randomUUID()}.jsonl`),
  );
  const outputTarget = existsSync(dirname(out))
    ? join(realpathSync(dirname(out)), basename(out))
    : out;
  const databaseTarget = realpathSync(config.dbPath);
  if ([databaseTarget, `${databaseTarget}-wal`, `${databaseTarget}-shm`].includes(outputTarget))
    throw new TrajectoryExportError('Output must not overwrite the database');
  const sqlite = new Database(config.dbPath, { readonly: true, fileMustExist: true });
  const db = drizzle(sqlite);
  try {
    let redacted = 0;
    const skipped: Partial<Record<SkipReason, number>> = {};
    const lines = db.transaction(() => {
      const builds = db
        .select()
        .from(build)
        .where(
          options.buildId !== undefined
            ? eq(build.id, options.buildId)
            : and(
                options.since === undefined ? undefined : gte(build.createdAt, options.since),
                options.until === undefined ? undefined : lte(build.createdAt, options.until),
              ),
        )
        .orderBy(asc(build.createdAt), asc(build.id))
        .all();
      if (options.buildId !== undefined && builds.length === 0)
        throw new TrajectoryExportError('Build not found');
      return builds.flatMap((b) => {
        try {
          return [exportBuild(b)];
        } catch (error) {
          if (!(error instanceof SkippedBuild) || options.buildId !== undefined) throw error;
          skipped[error.reason] = (skipped[error.reason] ?? 0) + 1;
          return [];
        }
      });
      function exportBuild(b: typeof build.$inferSelect) {
        const task = db.select().from(todo).where(eq(todo.id, b.todoId)).get();
        const steps = db
          .select()
          .from(step)
          .where(eq(step.buildId, b.id))
          .orderBy(asc(step.createdAt), asc(step.id))
          .all();
        const first = steps[0];
        const slot = first?.kind === 'plan' ? task?.assignment?.plan : task?.assignment?.build;
        const assigned = slot
          ? db.select().from(agent).where(eq(agent.id, slot.agentId)).get()
          : undefined;
        const usage = db
          .select()
          .from(tokenUsage)
          .where(eq(tokenUsage.buildId, b.id))
          .orderBy(asc(tokenUsage.model))
          .all();
        const feedback = db
          .select()
          .from(buildFeedback)
          .where(eq(buildFeedback.buildId, b.id))
          .orderBy(asc(buildFeedback.createdAt), asc(buildFeedback.id))
          .all();
        const judgments = [
          ...feedback.map((f) => ({
            side: f.side,
            at: f.createdAt,
            id: f.id,
            action: f.kind,
            reason: f.feedback,
          })),
          ...db
            .select()
            .from(message)
            .where(eq(message.conversationId, b.id))
            .all()
            .filter(
              (m) =>
                m.role === 'user' &&
                m.actor !== null &&
                (m.content === CONFIRM_ANNOUNCEMENT || m.content === MERGE_ANNOUNCEMENT),
            )
            .map((m) => ({
              side: m.content === CONFIRM_ANNOUNCEMENT ? 'plan' : 'build',
              at: m.createdAt,
              id: m.id,
              action: m.content === CONFIRM_ANNOUNCEMENT ? 'confirm' : 'approve',
              reason: null,
            })),
        ].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
        const sessions = steps.map((s) => ({
          step: s,
          ...readStepSession(join(config.dataDir, 'attachments/step-sessions', `${s.id}.jsonl`)),
        }));
        const processSteps = sessions.map(({ step: s, transcript }) => ({
          stepId: s.id,
          kind: s.kind,
          transcript,
          checkpointCommit: s.checkpointCommit,
        }));
        const runtimeModel = sessions[0]?.runtimeModels[0];
        const pack = trajectoryPackSchema.parse({
          buildId: b.id,
          input: {
            spec: task?.spec,
            sourceRef: task?.sourceRef,
            baseSha: b.baseSha,
            harnessHash: b.harnessHash,
            persona: assigned?.persona ?? null,
            agentId: assigned?.id,
            model: runtimeModel ?? (usage.length === 1 ? usage[0]?.model : undefined),
            skillInjection: first?.skillInjection ?? null,
          },
          process: {
            steps: processSteps,
            plans: db
              .select()
              .from(plan)
              .where(eq(plan.buildId, b.id))
              .orderBy(asc(plan.version), asc(plan.id))
              .all(),
            token_usage: usage,
          },
          judgments: {
            plan: judgments
              .filter((j) => j.side === 'plan')
              .map(({ action, reason }) => ({ action, reason })),
            diff: judgments
              .filter((j) => j.side === 'build')
              .map(({ action, reason }) => ({ action, reason })),
            gate_verdict: db
              .select()
              .from(gateVerdict)
              .where(eq(gateVerdict.buildId, b.id))
              .orderBy(asc(gateVerdict.createdAt), asc(gateVerdict.stepId))
              .all(),
            ciFixRounds: steps.filter((s) => s.kind === 'build' && s.prompt?.startsWith('[ci-fix]'))
              .length,
          },
          outcome: {
            merged: null,
            revertedWithin7d: null,
            fixedByLaterPr: null,
            costTotal: usage.length ? usage.reduce((sum, u) => sum + u.costTotal, 0) : null,
          },
        });
        const cleaned = redactSecrets(pack);
        redacted += cleaned.count;
        return JSON.stringify(trajectoryPackSchema.parse(cleaned.value));
      }
    });
    mkdirSync(dirname(out), { recursive: true });
    const temporary = `${out}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, lines.length ? `${lines.join('\n')}\n` : '', {
        flag: 'wx',
        mode: 0o600,
      });
      renameSync(temporary, out);
    } finally {
      rmSync(temporary, { force: true });
    }
    return { out, exported: lines.length, redacted, skipped };
  } finally {
    sqlite.close();
  }
}
