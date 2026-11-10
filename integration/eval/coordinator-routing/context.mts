import { readdirSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { parseAttachmentTokenLines } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { openDbWithHandle } from '../../../apps/server/src/db/client.js';
import {
  agentMemory,
  chiefMessage,
  chiefSummary,
  chiefThread,
  chiefTurnUsage,
  project,
  routingRule,
  step,
  team,
  user,
  workPolicy,
} from '../../../apps/server/src/db/schema.js';
import { seed } from '../../../apps/server/src/db/seed.js';
import { sendChiefMessage } from '../../../apps/server/src/services/chief.js';
import { chiefTurnContext } from '../../../apps/server/src/services/coordinator-steps.js';
import type { MachineDeps } from '../../../apps/server/src/services/machine-deps.js';
import { coordinatorProfile } from '../../../apps/server/src/services/routing-rules.js';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { type ReplayInput, replayTools } from './contract.mts';
import { seedReplayState } from './state.mts';

export function prepareReplayTurn(
  deps: MachineDeps,
  teamId: string,
  input: ReplayInput,
  provider = 'openai-codex',
  thinking = 'low',
) {
  deps.db
    .insert(routingRule)
    .values({
      id: 'eval-route',
      teamId,
      use: 'coordinator',
      provider,
      modelId: 'gpt-6.1-sol',
      thinkingLevel: thinking,
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
  seedReplayState(deps.db, teamId, input);
  const picked =
    input.chip === undefined ? undefined : input.projects.find((p) => p.name === input.chip)?.id;
  if (input.chip !== undefined && picked === undefined) throw new Error('Unknown project chip');
  return sendChiefMessage(deps, teamId, {
    threadId: null,
    content: input.request,
    projectId: picked,
  });
}

function without(row: object, keys: string[]) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)));
}

function compare(source: unknown, replay: unknown, path: string): void {
  if (isDeepStrictEqual(source, replay)) return;
  if (
    source !== null &&
    replay !== null &&
    typeof source === 'object' &&
    typeof replay === 'object'
  ) {
    const a = source as Record<string, unknown>;
    const b = replay as Record<string, unknown>;
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)]))
      compare(a[key], b[key], `${path}.${key}`);
  }
  throw new Error(`incomplete: replay context differs at ${path}`);
}

function productionContext(
  deps: MachineDeps,
  turn: typeof step.$inferSelect,
  thread: typeof chiefThread.$inferSelect,
) {
  const rollback = {};
  let context: ReturnType<typeof chiefTurnContext> | undefined;
  try {
    deps.db.transaction(() => {
      context = chiefTurnContext(deps, turn, thread, thread.chiefId);
      for (const ids of Object.values(context.memoryTrace)) {
        if (!Array.isArray(ids)) continue;
        for (const [index, id] of ids.entries()) {
          const row = deps.db.select().from(agentMemory).where(eq(agentMemory.id, id)).get();
          if (!row) throw new Error('incomplete: replay context missing memory');
          ids[index] = JSON.stringify(
            without(row, ['id', 'agentId', 'teamId', 'createdAt', 'updatedAt', 'lastInjectedAt']),
          );
        }
      }
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  if (!context) throw new Error('incomplete: replay context missing production context');
  return context;
}

export function assertReplayContext(
  deps: MachineDeps,
  turn: typeof step.$inferSelect,
  thread: typeof chiefThread.$inferSelect,
  input: ReplayInput,
): void {
  try {
    readdirSync(deps.skillsDir);
  } catch {
    throw new Error('incomplete: replay context unknown skills directory');
  }
  const db = deps.db;
  const history = db.select().from(chiefMessage).where(eq(chiefMessage.threadId, thread.id)).all();
  if (
    history.some(
      (row) =>
        row.id !== turn.id &&
        (row.createdAt <= turn.createdAt ||
          row.role === 'user' ||
          row.id.startsWith('chief-digest-')),
    ) ||
    db
      .select()
      .from(step)
      .where(eq(step.buildId, thread.id))
      .all()
      .some((row) => row.id !== turn.id) ||
    db.select().from(chiefSummary).where(eq(chiefSummary.threadId, thread.id)).get() ||
    db
      .select()
      .from(chiefTurnUsage)
      .where(eq(chiefTurnUsage.threadId, thread.id))
      .all()
      .some((row) => row.stepId !== turn.id)
  )
    throw new Error('incomplete: replay context contains unreproduced history');
  if (parseAttachmentTokenLines(input.request).length > 0)
    throw new Error('incomplete: replay context contains unseeded attachments');
  for (const row of history) {
    let content = row.content;
    if (typeof content === 'string') {
      try {
        content = JSON.parse(content);
      } catch {
        continue;
      }
    }
    if (
      content !== null &&
      typeof content === 'object' &&
      'kind' in content &&
      content.kind === 'toolcall'
    ) {
      const call = 'call' in content ? content.call : null;
      if (
        call === null ||
        typeof call !== 'object' ||
        !('name' in call) ||
        typeof call.name !== 'string' ||
        !replayTools.includes(call.name)
      )
        throw new Error('incomplete: replay context contains unseeded source tool inputs');
    }
  }
  const home = makeTestTempDir('eval-replay-context-');
  const opened = openDbWithHandle(':memory:');
  try {
    const defaults = seed(opened.db);
    const replayDeps = { ...deps, db: opened.db, user: defaults.user, skillsDir: home };
    const sent = prepareReplayTurn(replayDeps, defaults.team.id, input);
    const replayTurn = opened.db.select().from(step).where(eq(step.id, sent.message.id)).get();
    const replayThread = opened.db
      .select()
      .from(chiefThread)
      .where(eq(chiefThread.id, sent.thread.id))
      .get();
    const sourceTeam = db.select().from(team).where(eq(team.id, thread.teamId)).get();
    const replayTeam = opened.db.select().from(team).where(eq(team.id, defaults.team.id)).get();
    if (!replayTurn || !replayThread || !sourceTeam || !replayTeam)
      throw new Error('incomplete: replay context missing inputs');
    compare(
      without(sourceTeam, ['id', 'createdAt']),
      without(replayTeam, ['id', 'createdAt']),
      'team',
    );
    const sourceUser = db.select().from(user).where(eq(user.id, thread.userId)).get();
    if (!sourceUser || deps.user.id !== thread.userId)
      throw new Error('incomplete: replay context missing source user');
    compare(without(sourceUser, ['id']), without(defaults.user, ['id', 'type']), 'user');
    compare(
      db.select().from(workPolicy).where(eq(workPolicy.teamId, thread.teamId)).all(),
      [],
      'policies',
    );
    compare(
      db
        .select()
        .from(routingRule)
        .where(eq(routingRule.teamId, thread.teamId))
        .all()
        .map((row) => row.use),
      ['coordinator'],
      'routes',
    );
    const sourceRoute = coordinatorProfile(db, thread.teamId);
    const replayRoute = coordinatorProfile(opened.db, defaults.team.id);
    compare(
      sourceRoute && without(sourceRoute, ['id', 'teamId']),
      replayRoute && without(replayRoute, ['id', 'teamId']),
      'route',
    );
    const sourceProjects = db.select().from(project).where(eq(project.teamId, thread.teamId)).all();
    const replayProjects = opened.db.select().from(project).all();
    compare(
      sourceProjects.map((row) => without(row, ['teamId', 'createdAt', 'updatedAt'])),
      replayProjects.map((row) => without(row, ['teamId', 'createdAt', 'updatedAt'])),
      'projects',
    );
    const threadIdentity = [
      'id',
      'chiefId',
      'userId',
      'teamId',
      'title',
      'createdAt',
      'updatedAt',
      'lastTurnAt',
      'sessionId',
      'sessionOpenedAt',
      'activeRun',
    ];
    compare(without(thread, threadIdentity), without(replayThread, threadIdentity), 'thread');
    const lifecycle = [
      'id',
      'buildId',
      'status',
      'archiveStop',
      'quotaBlock',
      'checkpointCommit',
      'claimedAt',
      'lastHeartbeatAt',
      'finishedAt',
      'holdReason',
      'holdUntil',
      'holdCount',
      'claimCount',
      'createdAt',
    ];
    compare(
      without(turn, lifecycle),
      without(
        { ...replayTurn, ownerMessageIds: replayTurn.ownerMessageIds?.map(() => turn.id) },
        lifecycle,
      ),
      'step',
    );
    compare(
      productionContext(deps, turn, thread),
      productionContext(replayDeps, replayTurn, replayThread),
      'turn',
    );
  } finally {
    opened.close();
    releaseTestTempDir(home);
  }
}
