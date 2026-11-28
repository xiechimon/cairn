import { ACTIVE_STEP_STATUSES, type SecretBox } from '@cairn/shared';
import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { nowMs } from '../lib/ids.js';
import { listStoredMemoryEntries, memoryDocumentVersion } from '../services/memory.js';
import { coordinatorMemoryOwner } from '../services/routing-rules.js';
import { idleSummaryRoute } from './credentials.js';
import { createMemoryFlush } from './memory-flush.js';
import { providerBinding } from './provider-binding.js';
import { flushTranscript, summarizerFor } from './runtime/compaction.js';
import {
  type FailureScope,
  recordCompactionSuccess,
  reportCompactionFailure,
} from './runtime/failure-report.js';
import { createCoordinatorModels } from './runtime/models.js';
import { type SeedRow, seedMessageText } from './runtime/seed.js';
import type { ServerRuntimeConfig } from './runtime/server-runtime.js';

export const IDLE_MEMORY_FLUSH_MS = 10 * 60_000;
export const IDLE_MEMORY_FLUSH_RETRY_MS = 15 * 60_000;
export const IDLE_MEMORY_FLUSH_TIMEOUT_MS = 3 * 60_000;
export const IDLE_MEMORY_FLUSH_MAX_MESSAGES = 400;
const IDLE_MEMORY_FLUSH_CONCURRENCY = 2;

interface IdleMemoryLogger {
  info(fields: object, message: string): void;
}

export interface IdleMemoryOptions {
  idleMs?: number;
  retryMs?: number;
  timeoutMs?: number;
  fixedProviders?: ServerRuntimeConfig['fixedProviders'];
  logger?: IdleMemoryLogger;
}

export interface IdleMemorySweep {
  sweep(now?: number): void;
  drain(): Promise<void>;
  close(): Promise<void>;
}

interface Candidate {
  id: string;
  teamId: string;
  projectId: string | null;
  memoryFlushedMessageId: string | null;
  lastAt: number | null;
}

class IdleFlushStale extends Error {
  constructor() {
    super('idle memory flush is stale: the conversation moved on while it ran');
  }
}

class IdleFlushTimeout extends Error {
  constructor() {
    super('idle memory flush ran past its deadline');
  }
}

const THREAD_READY = sql`
  t.archivedAt is null
  and not exists (
    select 1 from step s where s.buildId = t.id and s.kind = 'chief'
      and s.status in (${sql.join(
        ACTIVE_STEP_STATUSES.map((s) => sql`${s}`),
        sql`, `,
      )})
  )
  and not exists (
    select 1 from coordinator_input i where i.threadId = t.id and i.state = 'pending'
  )`;

const ROW_FILTER = sql`
  role in ('user', 'assistant')
  and id not like 'chief-digest-%' and id not like 'chief-report-%'
  and (case when json_valid(content) then json_extract(content, '$[0].type') end) is not 'thinking'`;

const anchorRowId = (messageId: string | null) =>
  sql`coalesce((select rowid from chief_message where id = ${messageId ?? ''}), -1)`;

export function createIdleMemorySweep(
  deps: { db: Db; box: SecretBox },
  options: IdleMemoryOptions = {},
): IdleMemorySweep {
  const idleMs = options.idleMs ?? IDLE_MEMORY_FLUSH_MS;
  const retryMs = options.retryMs ?? IDLE_MEMORY_FLUSH_RETRY_MS;
  const timeoutMs = options.timeoutMs ?? IDLE_MEMORY_FLUSH_TIMEOUT_MS;
  const maxMessages = IDLE_MEMORY_FLUSH_MAX_MESSAGES;
  const logger = options.logger ?? { info: () => {} };
  const inFlight = new Map<string, { task: Promise<void>; cancel: () => void }>();
  const retryAt = new Map<string, number>();
  let closing = false;

  function newerThan(db: Pick<Db, 'get'>, threadId: string, anchorId: string | null): boolean {
    return (
      db.get(sql`
      select 1 from chief_message indexed by chief_message_thread_insert_idx
      where threadId = ${threadId} and rowid > ${anchorRowId(anchorId)} and ${ROW_FILTER}
      limit 1`) !== undefined
    );
  }

  function prepareTranscript(candidate: Candidate) {
    const rows = deps.db.all<SeedRow>(sql`
      select id, role, content, createdAt from (
        select rowid as rid, id, role, content, createdAt
        from chief_message indexed by chief_message_thread_insert_idx
        where threadId = ${candidate.id}
          and rowid > ${anchorRowId(candidate.memoryFlushedMessageId)}
          and ${ROW_FILTER}
        order by rowid desc
        limit ${maxMessages}
      )
      order by rid asc`);
    const last = rows.at(-1);
    if (!last) return null;
    const lines = rows.flatMap((row) => {
      const shaped = seedMessageText(row);
      return shaped === null ? [] : [`${shaped.role === 'user' ? '用户' : '总管'}：${shaped.text}`];
    });
    const transcript = flushTranscript(lines);
    return transcript.trim() === '' ? null : { rows, last, transcript };
  }

  async function flushCandidate(
    candidate: Candidate,
    prepared: NonNullable<ReturnType<typeof prepareTranscript>>,
    controller: AbortController,
    now: number,
    scope: FailureScope,
  ): Promise<void> {
    const { id, teamId, projectId } = candidate;
    const { rows, last, transcript } = prepared;
    const route = idleSummaryRoute(deps, teamId, projectId);
    if (route === null) {
      retryAt.set(id, now + retryMs);
      return;
    }
    const binding = providerBinding(deps, teamId, route);
    const models = createCoordinatorModels(options.fixedProviders);
    const keys = new Set<string>();
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
    const memoryState = (db: Parameters<typeof listStoredMemoryEntries>[0]) => {
      const agentId = coordinatorMemoryOwner(db, teamId);
      return agentId === undefined
        ? null
        : JSON.stringify([
            agentId,
            listStoredMemoryEntries(db, { agentId, teamId })
              .filter((row) => row.layer !== 'core' || row.content !== '')
              .map((row) => [memoryDocumentVersion(row), row.content]),
          ]);
    };
    const summarize = summarizerFor(
      models.models,
      {
        provider: binding.config.providerId,
        modelId: binding.modelId,
        thinkingLevel: binding.thinkingLevel ?? null,
      },
      { ...scope, stage: 'idle-memory-flush', timeoutMs, signal: controller.signal },
    );
    const signal = controller.signal;
    let capturedMemory: ReturnType<typeof memoryState>;
    const startAt = nowMs();
    const flush = createMemoryFlush(
      deps.db,
      { teamId, threadId: id, projectId },
      (result) => logger.info({ ...result, threadId: id }, 'idle memory flush'),
      (apply) =>
        deps.db.transaction((tx) => {
          signal.throwIfAborted();
          const ready = tx.get(
            sql`select 1 from chief_thread t where t.id = ${id} and ${THREAD_READY}`,
          );
          const included = tx.get<{ count: number }>(sql`
          select count(*) as count from chief_message
          where threadId = ${id} and id in (${sql.join(
            rows.map((row) => sql`${row.id}`),
            sql`, `,
          )})`);
          if (
            !ready ||
            included?.count !== rows.length ||
            newerThan(tx, id, last.id) ||
            capturedMemory === null ||
            capturedMemory !== memoryState(tx)
          )
            throw new IdleFlushStale();
          const result = apply(tx);
          const updated = tx.run(sql`
          update chief_thread set memoryFlushedAt = ${last.createdAt}, memoryFlushedMessageId = ${last.id}
          where id = ${id} and memoryFlushedMessageId is ${candidate.memoryFlushedMessageId}`);
          if (updated.changes !== 1) throw new IdleFlushStale();
          return result;
        }),
    );
    await flush.run(transcript, async (prompt) => {
      capturedMemory = memoryState(deps.db);
      let cancel: () => void = () => {};
      const cancelled = new Promise<never>((_, reject) => {
        cancel = () => reject(signal.reason);
        signal.addEventListener('abort', cancel, { once: true });
      });
      const expire = setTimeout(() => controller.abort(new IdleFlushTimeout()), timeoutMs);
      expire.unref?.();
      try {
        return await Promise.race([cancelled, summarize(prompt)]);
      } finally {
        clearTimeout(expire);
        signal.removeEventListener('abort', cancel);
      }
    });
    recordCompactionSuccess({ threadId: id }, 'idle-memory-flush', startAt);
  }

  function sweep(now = nowMs()): void {
    if (closing) return;
    const cutoff = now - idleMs;
    const rows = deps.db.all<Candidate>(sql`
      select t.id as id, t.teamId as teamId, t.projectId as projectId,
             t.memoryFlushedMessageId as memoryFlushedMessageId,
             (select m.createdAt from chief_message m
              where m.threadId = t.id and m.role in ('user', 'assistant')
                and m.id not like 'chief-digest-%' and m.id not like 'chief-report-%'
              order by m.createdAt desc, m.rowid desc limit 1) as lastAt
      from chief_thread t
      where ${THREAD_READY}
        and t.id not like 'chief-digest-%' and t.id not like 'chief-memory-%'
      order by lastAt asc`);
    for (const candidate of rows) {
      if (inFlight.size >= IDLE_MEMORY_FLUSH_CONCURRENCY) break;
      if (inFlight.has(candidate.id)) continue;
      if (candidate.lastAt === null || candidate.lastAt > cutoff) continue;
      const backoff = retryAt.get(candidate.id);
      if (backoff !== undefined) {
        if (backoff > now) continue;
        retryAt.delete(candidate.id);
      }
      if (!newerThan(deps.db, candidate.id, candidate.memoryFlushedMessageId)) continue;
      const prepared = prepareTranscript(candidate);
      if (prepared === null) continue;
      const controller = new AbortController();
      const scope: FailureScope = { threadId: candidate.id };
      const task = flushCandidate(candidate, prepared, controller, now, scope)
        .catch((error) => {
          if (error instanceof IdleFlushStale) return;
          if (closing) return;
          reportCompactionFailure(scope, 'idle-memory-flush', error, now);
          retryAt.set(candidate.id, nowMs() + retryMs);
        })
        .finally(() => {
          inFlight.delete(candidate.id);
        });
      inFlight.set(candidate.id, { task, cancel: () => controller.abort() });
    }
  }

  async function drain(): Promise<void> {
    while (inFlight.size > 0) {
      await Promise.all([...inFlight.values()].map((entry) => entry.task));
    }
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
