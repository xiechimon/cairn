import { WORKSPACE_FILE_CWD, workspaceFileInstanceSchema } from '@cairn/shared';
import { and, eq, gte } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { computerCall, type MessageFileSource, type step } from '../db/schema.js';
import { messageFileReferences } from './message-file-references.js';

export type { MessageFileSource };

type OwnedStep = Pick<typeof step.$inferSelect, 'id' | 'claimedAt' | 'machineId'>;

/** Whether a stored source can authorize a read: a named runner plus its opaque workspace token. */
export function eligibleFileSource(
  source: MessageFileSource | null | undefined,
): source is MessageFileSource & { machineId: string; workspace: string } {
  return (
    source !== null &&
    source !== undefined &&
    typeof source.machineId === 'string' &&
    source.machineId !== '' &&
    typeof source.workspace === 'string' &&
    source.workspace !== ''
  );
}

/** The only thing a browser, history page or SSE event learns about a source. */
export function workspaceFileLinksOf(
  source: MessageFileSource | null | undefined,
  content: unknown,
  role: unknown,
): { workspaceFileLinks: true; workspaceFilePaths: string[] } | Record<string, never> {
  return role === 'assistant' && eligibleFileSource(source)
    ? { workspaceFileLinks: true, workspaceFilePaths: messageFileReferences(content) }
    : {};
}

/** Remove the private source from a row-shaped value and project eligibility only. */
export function publicFileSourceRow<T extends object>(
  row: T,
): Omit<T, 'fileSource' | 'workspaceFileLinks'> & {
  workspaceFileLinks?: true;
  workspaceFilePaths?: string[];
} {
  const {
    fileSource,
    workspaceFileLinks: _supplied,
    workspaceFilePaths: _paths,
    ...rest
  } = row as T & {
    fileSource?: MessageFileSource | null;
    workspaceFileLinks?: unknown;
    workspaceFilePaths?: unknown;
    content?: unknown;
    role?: unknown;
  };
  return { ...rest, ...workspaceFileLinksOf(fileSource, rest.content, rest.role) } as Omit<
    T,
    'fileSource' | 'workspaceFileLinks'
  > & { workspaceFileLinks?: true; workspaceFilePaths?: string[] };
}

export function sameFileSource(
  a: MessageFileSource | null | undefined,
  b: MessageFileSource | null | undefined,
): boolean {
  if (a == null || b == null) return a == null && b == null;
  return (
    a.stepId === b.stepId &&
    a.machineId === b.machineId &&
    a.generation === b.generation &&
    (a.workspace ?? null) === (b.workspace ?? null)
  );
}

/**
 * What a write leaves on a row. `existing` is `undefined` when the row id is new, otherwise the
 * stored source. A rewrite never inherits or restores authority: if the row was written by another
 * step, generation or runner, or was never stamped, or the writer cannot vouch, the result is null,
 * and a null stays null for every later write. Only the same attempt may refine its own stamp.
 */
export function resolveFileSource(
  existing: MessageFileSource | null | undefined,
  incoming: MessageFileSource | null | undefined,
): MessageFileSource | null {
  if (existing === undefined) return incoming ?? null;
  if (existing === null || incoming === null || incoming === undefined) return null;
  if (existing.generation === null || existing.stepId !== incoming.stepId) return null;
  if (existing.generation !== incoming.generation) return null;
  if (
    existing.machineId !== null &&
    incoming.machineId !== null &&
    existing.machineId !== incoming.machineId
  ) {
    return null;
  }
  return incoming;
}

/**
 * Provenance for a row written by a runner-driven step. The workspace token is honoured only when
 * the write presented the step's current claim generation; anything else records the step and
 * runner without authority to read files.
 */
export function runnerFileSource(
  owned: OwnedStep,
  proof: { workspace?: string | undefined; generation?: number | undefined },
): MessageFileSource | null {
  if (owned.machineId === null) return null;
  const source: MessageFileSource = {
    stepId: owned.id,
    machineId: owned.machineId,
    generation: owned.claimedAt,
  };
  if (
    proof.workspace !== undefined &&
    proof.generation !== undefined &&
    owned.claimedAt !== null &&
    proof.generation === owned.claimedAt &&
    workspaceFileInstanceSchema.safeParse(proof.workspace).success
  ) {
    source.workspace = proof.workspace;
  }
  return source;
}

/**
 * The source to stamp on a row a turn writes. Only assistant rows carry one; `null` for every other
 * role so a rewrite of a row clears whatever a previous attempt stamped.
 */
export function turnFileSource(
  db: Pick<Db, 'select'>,
  owned: OwnedStep,
  role: 'system' | 'user' | 'assistant',
  proof: { workspace?: string | undefined; generation?: number | undefined } = {},
): MessageFileSource | null {
  if (role !== 'assistant') return null;
  return owned.machineId === null ? nativeFileSource(db, owned) : runnerFileSource(owned, proof);
}

/**
 * Provenance for a row written by a server-native turn. The workspace comes only from finished
 * `user_computer_shell` calls of this step that asked for the managed step directory under the
 * current claim generation, each returned by the authenticated runner that ran it. If those calls
 * name more than one runner or workspace, or one finished without proving its workspace, the
 * result carries no workspace: the step is recorded but nothing can be opened.
 */
export function nativeFileSource(db: Pick<Db, 'select'>, owned: OwnedStep): MessageFileSource {
  const base: MessageFileSource = {
    stepId: owned.id,
    machineId: null,
    generation: owned.claimedAt,
  };
  if (owned.claimedAt === null) return base;
  const calls = db
    .select({
      machineId: computerCall.machineId,
      workspace: computerCall.workspace,
      params: computerCall.params,
    })
    .from(computerCall)
    .where(
      and(
        eq(computerCall.stepId, owned.id),
        eq(computerCall.tool, 'user_computer_shell'),
        eq(computerCall.state, 'done'),
        gte(computerCall.createdAt, owned.claimedAt),
      ),
    )
    .all()
    .filter((call) => call.params.cwd === WORKSPACE_FILE_CWD);
  if (calls.length === 0) return base;
  const first = calls[0];
  if (
    first === undefined ||
    first.workspace === null ||
    calls.some((call) => call.machineId !== first.machineId || call.workspace !== first.workspace)
  ) {
    return base;
  }
  return { ...base, machineId: first.machineId, workspace: first.workspace };
}
