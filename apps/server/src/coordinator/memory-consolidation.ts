import {
  ACTIVE_STEP_STATUSES,
  CONSOLIDATION_EVIDENCE_MAX_CHARS,
  CONSOLIDATION_EVIDENCE_MESSAGES,
  CONSOLIDATION_MIN_ENTRIES,
  COORDINATOR_MEMORY_CONSOLIDATE_PROMPT_HEAD,
  type SecretBox,
} from '@cairn/shared';
import { and, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { project, team } from '../db/schema.js';
import { nowMs } from '../lib/ids.js';
import {
  applyConsolidation,
  ConsolidationStale,
  captureMemory,
  consolidationPrompt,
  entryCount,
  lastConsolidationAt,
  listConsolidations,
  memoryChangedAfter,
  parseConsolidationAnswer,
  planConsolidation,
  recordConsolidation,
} from '../services/memory-consolidation.js';
import { listedProjects } from '../services/personal-space.js';
import { coordinatorMemoryOwner } from '../services/routing-rules.js';
import { idleSummaryRoute } from './credentials.js';
import { providerBinding } from './provider-binding.js';
import { summarizerFor } from './runtime/compaction.js';
import { type FailureScope, reportCompactionFailure } from './runtime/failure-report.js';
import { createCoordinatorModels } from './runtime/models.js';
import { type SeedRow, seedMessageText } from './runtime/seed.js';
import type { ServerRuntimeConfig } from './runtime/server-runtime.js';

export const CONSOLIDATION_IDLE_MS = 30 * 60_000;
export const CONSOLIDATION_MIN_RUN_INTERVAL_MS = 6 * 60 * 60_000;
export const CONSOLIDATION_RETRY_MS = 30 * 60_000;
export const CONSOLIDATION_TIMEOUT_MS = 2 * 60_000;
const EVIDENCE_WINDOW_MS = 7 * 24 * 60 * 60_000;

interface ConsolidationLogger {
  info(fields: object, message: string): void;
}

export interface MemoryConsolidationOptions {
  idleMs?: number;
  minIntervalMs?: number;
  retryMs?: number;
  timeoutMs?: number;
  fixedProviders?: ServerRuntimeConfig['fixedProviders'];
  logger?: ConsolidationLogger;
}

export interface MemoryConsolidationSweep {
  sweep(now?: number): void;
  drain(): Promise<void>;
  close(): Promise<void>;
}

interface Scope {
  teamId: string;
  agentId: string;
  projectId: string | null;
}

interface Candidate extends Scope {
  changedAt: number | null;
  idleSince: number | null;
}

const ROW_FILTER = sql`
  m.role in ('user', 'assistant')
  and m.id not like 'chief-digest-%' and m.id not like 'chief-report-%'
  and (case when json_valid(m.content) then json_extract(m.content, '$[0].type') end) is not 'thinking'`;

const projectScope = (projectId: string | null) =>
  projectId === null ? sql`t.projectId is null` : sql`t.projectId = ${projectId}`;

function scopeKey(scope: Scope) {
  return `${scope.teamId}:${scope.projectId ?? 'team'}`;
}

export function createMemoryConsolidationSweep(
  deps: { db: Db; box: SecretBox },
  options: MemoryConsolidationOptions = {},
): MemoryConsolidationSweep {
  const idleMs = options.idleMs ?? CONSOLIDATION_IDLE_MS;
  const minIntervalMs = options.minIntervalMs ?? CONSOLIDATION_MIN_RUN_INTERVAL_MS;
  const retryMs = options.retryMs ?? CONSOLIDATION_RETRY_MS;
  const timeoutMs = options.timeoutMs ?? CONSOLIDATION_TIMEOUT_MS;
  const logger = options.logger ?? { info: () => {} };
  const inFlight = new Map<string, { task: Promise<void>; cancel: () => void }>();
  const retryAt = new Map<string, number>();
  let closing = false;

  function lastMessageAt(scope: Scope): number | null {
    const row = deps.db.get<{ at: number | null }>(sql`
      select max(m.createdAt) as at from chief_message m
      join chief_thread t on t.id = m.threadId
      where t.teamId = ${scope.teamId}
        and t.archivedAt is null
        and ${projectScope(scope.projectId)}
        and ${ROW_FILTER}`);
    return row?.at ?? null;
  }

  function scopeBusy(scope: Scope): boolean {
    return (
      deps.db.get(sql`
        select 1 from chief_thread t
        where t.teamId = ${scope.teamId}
          and t.archivedAt is null
          and ${projectScope(scope.projectId)}
          and (
            exists (
              select 1 from step s where s.buildId = t.id and s.kind = 'chief'
                and s.status in (${sql.join(
                  ACTIVE_STEP_STATUSES.map((status) => sql`${status}`),
                  sql`, `,
                )})
            )
            or exists (
              select 1 from coordinator_input i where i.threadId = t.id and i.state = 'pending'
            )
          )
        limit 1`) !== undefined
    );
  }

  function evidence(scope: Scope, now: number) {
    const rows = deps.db.all<SeedRow>(sql`
      select id, role, content, createdAt from (
        select m.rowid as rid, m.id as id, m.role as role, m.content as content,
               m.createdAt as createdAt
        from chief_message m
        join chief_thread t on t.id = m.threadId
        where t.teamId = ${scope.teamId}
          and t.archivedAt is null
          and ${projectScope(scope.projectId)}
          and m.createdAt >= ${now - EVIDENCE_WINDOW_MS}
          and ${ROW_FILTER}
        order by m.rowid desc
        limit ${CONSOLIDATION_EVIDENCE_MESSAGES}
      )
      order by rid asc`);
    const messages: { role: string; text: string; at: number }[] = [];
    let budget = CONSOLIDATION_EVIDENCE_MAX_CHARS;
    for (const row of rows) {
      const shaped = seedMessageText(row);
      if (shaped === null || budget <= 0) continue;
      const text = shaped.text.length > budget ? shaped.text.slice(0, budget) : shaped.text;
      budget -= text.length;
      messages.push({ role: shaped.role, text, at: row.createdAt });
    }
    return messages;
  }

  function scopesForTeam(teamId: string, agentId: string): Scope[] {
    const projects = deps.db
      .select({ id: project.id })
      .from(project)
      .where(and(listedProjects(teamId), isNull(project.archivedAt)))
      .all()
      .filter((row) => row.id !== '');
    return [
      { teamId, agentId, projectId: null },
      ...projects.map((row) => ({ teamId, agentId, projectId: row.id })),
    ];
  }

  function candidateFor(scope: Scope, now: number): Candidate | null {
    if (entryCount(deps.db, scope) < CONSOLIDATION_MIN_ENTRIES) return null;
    const last = lastConsolidationAt(deps.db, scope.teamId, scope.projectId);
    if (last !== null && now - last.startedAt < minIntervalMs) return null;
    const changedAt = memoryChangedAfter(deps.db, scope, last?.finishedAt ?? 0);
    if (last !== null && changedAt === null) return null;
    const idleSince = lastMessageAt(scope);
    if (idleSince !== null && idleSince > now - idleMs) return null;
    if (scopeBusy(scope)) return null;
    return { ...scope, changedAt, idleSince };
  }

  async function consolidate(candidate: Candidate, now: number, controller: AbortController) {
    const { teamId, projectId } = candidate;
    const route = idleSummaryRoute(deps, teamId, projectId);
    if (route === null) {
      retryAt.set(scopeKey(candidate), now + retryMs);
      return;
    }
    const computedAt = nowMs();
    const captured = captureMemory(deps.db, candidate, evidence(candidate, computedAt));
    if (captured === null) return;
    const binding = providerBinding(deps, teamId, route);
    const models = createCoordinatorModels(options.fixedProviders);
    const keys = new Set<string>();
    const scope: FailureScope = {};
    scope.scrub = (message) => {
      let result = message;
      for (const key of keys) result = result.split(key).join('[redacted]');
      return result;
    };
    models.useProvider(
      binding.config,
      async () => {
        const key = await binding.resolveKey();
        if (key) keys.add(key);
        return key;
      },
      binding.observe,
    );
    const summarize = summarizerFor(
      models.models,
      {
        provider: binding.config.providerId,
        modelId: binding.modelId,
        thinkingLevel: binding.thinkingLevel ?? null,
      },
      { ...scope, stage: 'memory-consolidation', timeoutMs, signal: controller.signal },
    );
    const meta = {
      teamId,
      agentId: candidate.agentId,
      projectId,
      provider: binding.config.providerId,
      modelId: binding.modelId,
      startedAt: computedAt,
    };
    const signal = controller.signal;
    let cancel: () => void = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      cancel = () => reject(signal.reason);
      signal.addEventListener('abort', cancel, { once: true });
    });
    const expire = setTimeout(
      () => controller.abort(new Error('memory consolidation ran past its deadline')),
      timeoutMs,
    );
    expire.unref?.();
    const previous = listConsolidations(deps.db, teamId, projectId, 1)[0] ?? null;
    let raw: string;
    try {
      raw = await Promise.race([
        cancelled,
        summarize(
          consolidationPrompt(captured, COORDINATOR_MEMORY_CONSOLIDATE_PROMPT_HEAD, previous),
        ),
      ]);
    } finally {
      clearTimeout(expire);
      signal.removeEventListener('abort', cancel);
    }
    let answer: ReturnType<typeof parseConsolidationAnswer>;
    try {
      answer = parseConsolidationAnswer(raw);
    } catch (error) {
      logger.info({ ...meta, error: String(error) }, 'memory consolidation answer rejected');
      recordConsolidation(deps.db, {
        ...meta,
        status: 'rejected',
        summary: 'the answer was not usable JSON',
        beforeText: captured.indexText,
        afterText: '',
        edits: [],
        dropFiles: [],
      });
      return;
    }
    const planned = planConsolidation(captured, answer);
    if (!planned.ok) {
      if (planned.why === '') {
        recordConsolidation(deps.db, {
          ...meta,
          status: 'empty',
          summary: '',
          beforeText: captured.indexText,
          afterText: captured.indexText,
          edits: [],
          dropFiles: [],
        });
        return;
      }
      logger.info({ ...meta, why: planned.why }, 'memory consolidation edit rejected');
      recordConsolidation(deps.db, {
        ...meta,
        status: 'rejected',
        summary: planned.why,
        beforeText: captured.indexText,
        afterText: '',
        edits: [],
        dropFiles: [],
      });
      return;
    }
    const messageAt = lastMessageAt(candidate);
    if (messageAt !== null && messageAt > computedAt)
      throw new ConsolidationStale('the conversation resumed while the consolidation ran');
    if (scopeBusy(candidate))
      throw new ConsolidationStale('the scope became busy while the consolidation ran');
    const record = applyConsolidation(deps.db, captured, planned.plan, meta);
    logger.info(
      { ...meta, edits: record.edits.length, dropped: record.dropFiles.length },
      'memory consolidation applied',
    );
  }

  function sweep(now = nowMs()): void {
    if (closing) return;
    if (inFlight.size >= 1) return;
    const candidates: Candidate[] = [];
    const teams = deps.db.select({ id: team.id }).from(team).all();
    for (const row of teams) {
      const agentId = coordinatorMemoryOwner(deps.db, row.id);
      if (agentId === undefined) continue;
      for (const scope of scopesForTeam(row.id, agentId)) {
        const key = scopeKey(scope);
        if (inFlight.has(key)) continue;
        const backoff = retryAt.get(key);
        if (backoff !== undefined) {
          if (backoff > now) continue;
          retryAt.delete(key);
        }
        const candidate = candidateFor(scope, now);
        if (candidate !== null) candidates.push(candidate);
      }
    }
    if (candidates.length === 0) return;
    const candidate = candidates.sort(
      (a, b) =>
        (a.changedAt ?? a.idleSince ?? 0) - (b.changedAt ?? b.idleSince ?? 0) ||
        (a.idleSince ?? 0) - (b.idleSince ?? 0),
    )[0];
    if (candidate === undefined) return;
    const controller = new AbortController();
    const key = scopeKey(candidate);
    const task = consolidate(candidate, now, controller)
      .catch((error) => {
        if (error instanceof ConsolidationStale) {
          retryAt.set(key, nowMs() + retryMs);
          return;
        }
        if (closing) return;
        reportCompactionFailure({}, 'memory-consolidation', error, now);
        retryAt.set(key, nowMs() + retryMs);
      })
      .finally(() => {
        inFlight.delete(key);
      });
    inFlight.set(key, { task, cancel: () => controller.abort() });
  }

  async function drain(): Promise<void> {
    while (inFlight.size > 0)
      await Promise.allSettled([...inFlight.values()].map((entry) => entry.task));
  }

  return {
    sweep,
    drain,
    close: async () => {
      closing = true;
      for (const entry of inFlight.values()) entry.cancel();
      await drain();
    },
  };
}
