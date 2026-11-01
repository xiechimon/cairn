import type { SecretBox, StepRecord, UserRecord } from '@cairn/shared';
import { isChiefConversationId } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, chiefThread, message, step, todo } from '../db/schema.js';
import type { FetchLike } from '../lib/github.js';
import { NotFoundError } from './builds.js';
import { upsertChiefMessage } from './chief.js';
import { agentForStep as agentForStepEligibility } from './dispatch-eligibility.js';
import type { ConversationStreamHub, TeamStreamHub } from './events.js';
import type { MachineWakeHub } from './machine-wake-hub.js';
import type { OAuthClientConfig } from './oauth.js';
import type { VapidKeys } from './push.js';
import { pendingWorkerQuestion, pushWorkerQuestion } from './thread-push.js';

export function isChiefConversation(id: string): boolean {
  return isChiefConversationId(id);
}

export interface MachineDeps {
  intakeAgentAllowlist?: readonly string[];
  db: Db;
  hub: TeamStreamHub;
  machineHub: MachineWakeHub;
  box: SecretBox;
  user: UserRecord;
  vapidKeys?: VapidKeys | null;
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
  deps: {
    db: Db;
    convHub?: ConversationStreamHub;
    user?: UserRecord;
    vapidKeys?: VapidKeys | null;
  },
  row: MessageRowInput & { conversationId: string },
): void {
  const question = row.role === 'assistant' ? pendingWorkerQuestion(row.content) : null;
  const prior =
    question !== null && deps.user !== undefined
      ? deps.db.select().from(message).where(eq(message.id, row.id)).get()
      : undefined;
  deps.db
    .insert(message)
    .values(row)
    .onConflictDoUpdate({
      target: message.id,
      set: { role: row.role, content: row.content, createdAt: row.createdAt, actor: null },
    })
    .run();
  deps.convHub?.publishMessage(row.conversationId, row);
  if (
    deps.user !== undefined &&
    question !== null &&
    pendingWorkerQuestion(prior?.content) === null
  ) {
    pushWorkerQuestion({ ...deps, user: deps.user }, row.conversationId, question);
  }
}

export function upsertChiefRow(
  deps: { db: Db; convHub?: ConversationStreamHub },
  row: MessageRowInput & { threadId: string },
): void {
  upsertChiefMessage(deps.db, row);
  deps.convHub?.publishMessage(row.threadId, row);
}
