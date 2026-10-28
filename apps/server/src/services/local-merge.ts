import {
  conversationBranch,
  type LocalMergeReport,
  localMergeCommandSchema,
  parseGithubIssueSourceRef,
  parseLocalMergeInstruction,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { build, step, todo } from '../db/schema.js';
import { conflict } from '../lib/errors.js';
import { nowMs } from '../lib/ids.js';
import { type BuildDeps, completeStep, enqueueStep } from './builds.js';
import { triggerChiefWakes } from './chief.js';
import { localGateFacts } from './local-merge-facts.js';
import type { MachineDeps } from './machine-deps.js';
import { publishStepStatus, upsertMessage } from './machine-deps.js';
import type { mergeReadiness } from './merge-gate/readiness.js';
import { notifyTodoPhase } from './notifications.js';
import { getTodo } from './todos.js';

export async function enqueueLocalMerge(
  deps: BuildDeps,
  buildId: string,
  defaultBranch: string,
  approved = false,
): Promise<{ enqueued: boolean; readiness: ReturnType<typeof mergeReadiness> | null }> {
  const facts = await localGateFacts(deps, buildId, defaultBranch);
  if (facts === null) throw conflict('Local merge requires a local project');
  const { readiness, judgedBase, judgedDigest } = facts;
  const inputs = facts.inputs;
  const config = { mergePolicy: inputs.policy.mergePolicy, localChecks: facts.requiredChecks };
  const lands = config.mergePolicy === 'autonomous' || (approved && config.mergePolicy === 'human');
  const blocking =
    config.mergePolicy === 'human'
      ? readiness.blockers.filter((b) => b.code !== 'policy-human')
      : readiness.blockers;
  if (!lands || blocking.length > 0 || !readiness.headSha || !readiness.patchDigest)
    return { enqueued: false, readiness };
  const buildRow = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  const todoRow = buildRow
    ? deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get()
    : undefined;
  if (!buildRow || !todoRow) throw conflict('Local merge requires a build and its todo');
  const required = inputs.checks?.required ?? [];
  if (JSON.stringify(required) !== JSON.stringify(config.localChecks) || required.length === 0)
    throw conflict('Local required checks differ from the judged configuration');
  const source = todoRow.sourceRef ? parseGithubIssueSourceRef(todoRow.sourceRef) : null;
  const command = localMergeCommandSchema.parse({
    projectId: todoRow.projectId,
    buildId,
    defaultBranch,
    judgedBase,
    judgedHead: readiness.headSha,
    judgedPatchDigest: readiness.patchDigest,
    workBranch: conversationBranch(buildId),
    localChecks: required,
    message:
      source === null
        ? todoRow.title
        : `${todoRow.title}\n\nCloses ${source.owner}/${source.repo}#${source.issueNumber}`,
    identity: { name: deps.user.displayName, email: 'cairn@localhost' },
  });
  enqueueStep(
    deps,
    buildId,
    'merge',
    todoRow.teamId,
    JSON.stringify({
      kind: 'local-merge',
      command,
      judgedDigest,
    }),
  );
  return { enqueued: true, readiness };
}

export function applyLocalMergeReport(
  deps: MachineDeps,
  row: typeof step.$inferSelect,
  report: LocalMergeReport,
): boolean {
  const command = parseLocalMergeInstruction(row.prompt);
  if (!command) throw conflict('No local merge command was issued for this step');
  if (
    row.kind !== 'merge' ||
    JSON.stringify(command) !== JSON.stringify(report.command) ||
    command.buildId !== row.buildId
  )
    throw conflict('Local merge report does not match its command');
  const buildRow = deps.db.select().from(build).where(eq(build.id, row.buildId)).get();
  const record = buildRow ? getTodo(deps, buildRow.todoId) : null;
  if (!record || record.projectId !== command.projectId)
    throw conflict('Local merge project changed');
  if (row.status !== 'claimed') return true;
  const { result } = report;
  deps.db
    .update(step)
    .set({
      status: 'done',
      finishedAt: nowMs(),
      ...(result.outcome === 'merged' ? { checkpointCommit: result.commit } : {}),
    })
    .where(eq(step.id, row.id))
    .run();
  upsertMessage(deps, {
    id: `local-merge-${row.id}`,
    conversationId: row.buildId,
    role: 'system',
    content: JSON.stringify({ kind: 'local-merge-result', ...report }),
    createdAt: nowMs(),
  });
  if (result.outcome === 'merged') {
    completeStep(deps, row.id);
  } else if (record.latestBuildId === row.buildId && record.phase === 'review') {
    const notice = notifyTodoPhase(
      deps,
      record,
      'review',
      `Local merge ${result.outcome}: ${result.reason}`,
    );
    upsertMessage(deps, {
      id: `local-merge-notice-${row.id}`,
      conversationId: row.buildId,
      role: 'system',
      content: `Local merge ${result.outcome}: ${result.reason}. Notification ${notice.id}.`,
      createdAt: nowMs(),
    });
    if (result.outcome === 'recheck') triggerChiefWakes(deps, record, 'review');
  }
  publishStepStatus(deps, row.id);
  deps.machineHub.wake(record.teamId);
  return true;
}
