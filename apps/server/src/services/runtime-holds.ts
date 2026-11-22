import { runtimeReportSatisfies, runtimeUpdateRequired } from '@cairn/shared';
import { and, eq, isNotNull, isNull, like } from 'drizzle-orm';
import { build, clientMessage, machine, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { applyBuildStepAction, type BuildDeps, NotFoundError } from './builds.js';
import { ClientMessageConflict, findClientMessage } from './client-message.js';
import { retryIsParked } from './retry-parking.js';
import { insertMessageRow } from './transcript.js';

const CLAUDE_RUNTIME_RE = /claude/i;
const RUNTIME_RESUME_RECEIPT = 'runtime-resume-%';
const HELD_ERROR_SCAN_LIMIT = 8192;

export async function resumeRuntimeHeldBuilds(deps: BuildDeps, teamId: string): Promise<void> {
  const voters = deps.db
    .select()
    .from(machine)
    .where(and(eq(machine.teamId, teamId), eq(machine.online, true), isNull(machine.retiredAt)))
    .all()
    .filter((row) => row.claudeCodeReport?.installed === true);
  const held = deps.db
    .select()
    .from(todo)
    .where(
      and(
        eq(todo.teamId, teamId),
        eq(todo.phase, 'failed'),
        isNull(todo.archivedAt),
        isNotNull(todo.latestBuildId),
      ),
    )
    .all();
  for (const row of held) {
    const buildId = row.latestBuildId;
    if (buildId === null) continue;
    const buildRow = deps.db.select().from(build).where(eq(build.id, buildId)).get();
    const heldError = buildRow?.errorMessage ?? '';
    const update =
      heldError !== '' && retryIsParked(heldError)
        ? runtimeUpdateRequired(heldError.slice(0, HELD_ERROR_SCAN_LIMIT))
        : null;
    if (update === null || update.runtime === null || !CLAUDE_RUNTIME_RE.test(update.runtime))
      continue;
    const satisfying = voters.filter((runner) =>
      runtimeReportSatisfies(runner.claudeCodeReport?.bin?.version ?? null, update.required),
    );
    if (satisfying.length === 0 || satisfying.length !== voters.length) continue;
    const resumedBefore = deps.db
      .select({ id: build.id })
      .from(build)
      .innerJoin(clientMessage, eq(clientMessage.scopeId, build.id))
      .where(
        and(eq(build.todoId, row.id), like(clientMessage.clientMessageId, RUNTIME_RESUME_RECEIPT)),
      )
      .get();
    if (resumedBefore !== undefined) continue;
    const receipt = `runtime-resume-${buildId}`;
    if (findClientMessage(deps.db, buildId, receipt) !== undefined) continue;
    try {
      await applyBuildStepAction(
        deps,
        buildId,
        { action: 'restart', feedback: '', clientMessageId: receipt },
        'cairn',
        'runtime',
      );
    } catch (error) {
      if (
        error instanceof HttpError ||
        error instanceof ClientMessageConflict ||
        error instanceof NotFoundError
      )
        continue;
      throw error;
    }
    const sent = findClientMessage<{ conversationId?: string }>(deps.db, buildId, receipt);
    insertMessageRow(deps, sent?.conversationId ?? buildId, {
      id: newRecordId(),
      role: 'system',
      content: `Resumed automatically: the Runner reports built-in ${update.runtime} ${update.required} or newer.`,
      createdAt: nowMs(),
    });
  }
}
