import type { SecretBox, StepRecord, UserRecord } from '@cairn/shared';
import { isChiefConversationId } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, chiefMessage, chiefThread, message, step, todo } from '../db/schema.js';
import { conflict } from '../lib/errors.js';
import type { FetchLike } from '../lib/github.js';
import { nowMs } from '../lib/ids.js';
import { NotFoundError } from './builds.js';
import { agentForStep as agentForStepEligibility } from './dispatch-eligibility.js';
import type { ConversationStreamHub, TeamStreamHub } from './events.js';
import type { MachineWakeHub } from './machine-wake-hub.js';
import type { OAuthClientConfig } from './oauth.js';

export function isChiefConversation(id: string): boolean {
  return isChiefConversationId(id);
}

export interface MachineDeps {
  db: Db;
  hub: TeamStreamHub;
  machineHub: MachineWakeHub;
  box: SecretBox;
  user: UserRecord;
  reposDir: string;
  attachmentsDir: string;
  skillsDir: string;
  mcpConfigPath?: string;
  convHub?: ConversationStreamHub;
  githubFetch?: FetchLike;
  oauthClient?: OAuthClientConfig | null;
}

export function publishStepStatus(deps: MachineDeps, stepId: string): void {
  if (!deps.convHub) return;
  const row = deps.db.select().from(step).where(eq(step.id, stepId)).get();
  if (!row) return;
  deps.convHub.publishStep(row.buildId, {
    id: row.id,
    buildId: row.buildId,
    kind: row.kind,
    machineId: row.machineId,
    createdAt: row.createdAt,
    status: row.status,
    checkpointCommit: row.checkpointCommit,
    skillInjection: row.skillInjection ?? null,
  });
}

export function agentForStep(
  deps: MachineDeps,
  todoRow: typeof todo.$inferSelect,
  kind: StepRecord['kind'],
  prompt: string | null = null,
) {
  return agentForStepEligibility(deps.db, todoRow, kind, prompt);
}

export function ownedStep(deps: MachineDeps, machineId: string, stepId: string) {
  const row = deps.db.select().from(step).where(eq(step.id, stepId)).get();
  if (!row) throw new NotFoundError(`step ${stepId}`);
  if (row.machineId !== machineId) throw new NotFoundError(`step ${stepId} (not yours)`);
  return row;
}

export function stepTeamId(deps: MachineDeps, stepRow: typeof step.$inferSelect): string | null {
  const { db } = deps;
  if (isChiefConversation(stepRow.buildId)) {
    return (
      db
        .select({ teamId: chiefThread.teamId })
        .from(chiefThread)
        .where(eq(chiefThread.id, stepRow.buildId))
        .get()?.teamId ?? null
    );
  }
  const todoRow = db
    .select({ teamId: todo.teamId })
    .from(build)
    .innerJoin(todo, eq(build.todoId, todo.id))
    .where(eq(build.id, stepRow.buildId))
    .get();
  return todoRow?.teamId ?? null;
}

type MessageRowInput = {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: unknown;
  createdAt: number;
};

export function upsertMessage(
  deps: { db: Db; convHub?: ConversationStreamHub },
  row: MessageRowInput & { conversationId: string },
): void {
  const written = deps.db
    .insert(message)
    .values(row)
    .onConflictDoUpdate({
      target: message.id,
      setWhere: eq(message.conversationId, row.conversationId),
      set: { role: row.role, content: row.content, createdAt: row.createdAt },
    })
    .run();
  if (written.changes === 0)
    throw conflict('Transcript message ID belongs to another conversation');
  deps.convHub?.publishMessage(row.conversationId, row);
}

export function upsertChiefRow(
  deps: { db: Db; convHub?: ConversationStreamHub },
  row: MessageRowInput & { threadId: string },
): void {
  const written = deps.db
    .insert(chiefMessage)
    .values(row)
    .onConflictDoUpdate({
      target: chiefMessage.id,
      setWhere: eq(chiefMessage.threadId, row.threadId),
      set: { role: row.role, content: row.content, createdAt: row.createdAt },
    })
    .run();
  if (written.changes === 0)
    throw conflict('Transcript message ID belongs to another chief thread');
  deps.db
    .update(chiefThread)
    .set({ updatedAt: nowMs() })
    .where(eq(chiefThread.id, row.threadId))
    .run();
  deps.convHub?.publishMessage(row.threadId, row);
}
