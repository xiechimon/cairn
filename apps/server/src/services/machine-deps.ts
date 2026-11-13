import type { GitIdentity, SecretBox, StepRecord, UserRecord } from '@cairn/shared';
import { isChiefConversationId } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, chiefThread, message, step, todo } from '../db/schema.js';
import type { FetchLike } from '../lib/github.js';
import { NotFoundError } from './builds.js';
import { upsertChiefMessage } from './chief.js';
import type { ConversationStreamHub, TeamStreamHub } from './events.js';
import type { MachineWakeHub } from './machine-wake-hub.js';
import type { OAuthClientConfig } from './oauth.js';
import type { VapidKeys } from './push.js';
import { profileForStep as profileForStepRoute } from './routing-rules.js';

export function isChiefConversation(id: string): boolean {
  return isChiefConversationId(id);
}

export interface MachineDeps {
  githubAppTokenSocket?: string | null | undefined;
  githubAppIdentity?: GitIdentity | null | undefined;
  db: Db;
  hub: TeamStreamHub;
  machineHub: MachineWakeHub;
  box: SecretBox;
  user: UserRecord;
  vapidKeys?: VapidKeys | null;
  reposDir: string;
  workspacesDir?: string | undefined;
  attachmentsDir: string;
  skillsDir: string;
  mcpConfigPath?: string;
  convHub?: ConversationStreamHub;
  githubFetch?: FetchLike;
  oauthFetch?: FetchLike;
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

export function profileForStep(
  deps: MachineDeps,
  todoRow: typeof todo.$inferSelect,
  kind: StepRecord['kind'],
  stepId: string | null = null,
) {
  return profileForStepRoute(deps.db, todoRow, kind, stepId);
}

export function ownedStep(deps: MachineDeps, machineId: string | null, stepId: string) {
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
  deps.db
    .insert(message)
    .values(row)
    .onConflictDoUpdate({
      target: message.id,
      set: { role: row.role, content: row.content, createdAt: row.createdAt, actor: null },
    })
    .run();
  deps.convHub?.publishMessage(row.conversationId, row);
}

export function upsertChiefRow(
  deps: { db: Db; convHub?: ConversationStreamHub },
  row: MessageRowInput & { threadId: string },
): void {
  const stored = upsertChiefMessage(deps.db, row);
  deps.convHub?.publishMessage(row.threadId, stored);
}
