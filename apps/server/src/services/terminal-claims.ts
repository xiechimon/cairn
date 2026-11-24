import {
  ACTIVE_STEP_STATUSES,
  type ClaimShield,
  createClaimShield,
  isChiefConversationId,
  type MergeRecord,
  NO_TERMINAL_CLAIM_FACTS,
  parseLocalMergeInstruction,
  rewriteTerminalClaims,
  type TerminalClaimFacts,
  type TerminalClaimRewrite,
  unbackedTerminalClaims,
} from '@cairn/shared';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  autonomousMergeAdmission,
  build,
  chiefMessage,
  step,
  threadPr,
  todo,
} from '../db/schema.js';
import { githubRepoOfProject, projectOfTodo } from './git.js';

const TODO_REF = /\(todo:([A-Za-z0-9_-]{1,64})\)/g;
const PROVENANCE_TODO = /provenance=(?:watch|todo):([A-Za-z0-9_-]{1,64})/;
const CONTEXT_MESSAGES = 24;

const todoIdsOf = (text: string): string[] => [...text.matchAll(TODO_REF)].map((m) => m[1] ?? '');
const provenanceTodoIds = (text: string): string[] => {
  const match = PROVENANCE_TODO.exec(text);
  return match?.[1] === undefined ? [] : [match[1]];
};

export function claimTodoIds(
  db: Db,
  threadId: string,
  turnPrompt: string | null,
  text: string,
): string[] {
  const direct = [
    ...provenanceTodoIds(turnPrompt ?? ''),
    ...todoIdsOf(turnPrompt ?? ''),
    ...todoIdsOf(text),
  ];
  if (direct.length > 0) return [...new Set(direct)];
  const recent = db
    .select({ content: chiefMessage.content })
    .from(chiefMessage)
    .where(eq(chiefMessage.threadId, threadId))
    .orderBy(desc(chiefMessage.createdAt))
    .limit(CONTEXT_MESSAGES)
    .all();
  const ids = recent.flatMap((row) => [
    ...todoIdsOf(typeof row.content === 'string' ? row.content : JSON.stringify(row.content)),
  ]);
  return [...new Set(ids)];
}

function buildIdsOfTodos(db: Db, todoIds: readonly string[]): string[] {
  if (todoIds.length === 0) return [];
  return db
    .select({ id: build.id })
    .from(build)
    .innerJoin(todo, eq(todo.latestBuildId, build.id))
    .where(inArray(build.todoId, [...todoIds]))
    .all()
    .map((row) => row.id);
}

function prLinkedBuildIds(db: Db, buildIds: readonly string[]): Set<string> {
  if (buildIds.length === 0) return new Set();
  const rows = db
    .select({ id: build.id, todoId: build.todoId, prNumber: build.prNumber })
    .from(build)
    .where(and(inArray(build.id, [...buildIds]), isNotNull(build.prNumber)))
    .all();
  const linked = new Set<string>();
  for (const row of rows) {
    const todoRow = db.select().from(todo).where(eq(todo.id, row.todoId)).get();
    if (todoRow === undefined) continue;
    if (githubRepoOfProject(projectOfTodo(db, todoRow)) !== null) linked.add(row.id);
  }
  return linked;
}

function mergeRecord(db: Db, buildIds: readonly string[]): MergeRecord {
  const steps =
    buildIds.length === 0
      ? []
      : db
          .select({ status: step.status, prompt: step.prompt, buildId: step.buildId })
          .from(step)
          .where(and(inArray(step.buildId, [...buildIds]), eq(step.kind, 'merge')))
          .all();
  if (steps.some((row) => (ACTIVE_STEP_STATUSES as readonly string[]).includes(row.status)))
    return 'in-flight';
  const settledGitHub =
    buildIds.length > 0 &&
    db
      .select({ state: autonomousMergeAdmission.state })
      .from(autonomousMergeAdmission)
      .where(
        and(
          inArray(autonomousMergeAdmission.buildId, [...buildIds]),
          eq(autonomousMergeAdmission.state, 'merged'),
        ),
      )
      .all().length > 0;
  const mergedPull =
    buildIds.length > 0 &&
    db
      .select({ state: threadPr.state })
      .from(threadPr)
      .where(and(inArray(threadPr.buildId, [...buildIds]), eq(threadPr.state, 'merged')))
      .all().length > 0;
  if (settledGitHub || mergedPull) return 'done';
  const prLinked = prLinkedBuildIds(db, buildIds);
  if (
    steps.some(
      (row) =>
        row.status === 'done' &&
        parseLocalMergeInstruction(row.prompt) === null &&
        !prLinked.has(row.buildId),
    )
  )
    return 'done';
  if (steps.some((row) => row.status === 'failed' || row.status === 'stopped')) return 'failed';
  if (steps.some((row) => row.status === 'done' && !prLinked.has(row.buildId))) return 'failed';
  if (steps.some((row) => row.status === 'done')) return 'in-flight';
  return 'none';
}

export function terminalClaimFacts(db: Db, todoIds: readonly string[]): TerminalClaimFacts {
  if (todoIds.length === 0) return NO_TERMINAL_CLAIM_FACTS;
  const buildIds = buildIdsOfTodos(db, todoIds);
  if (buildIds.length === 0) return NO_TERMINAL_CLAIM_FACTS;
  const pushed =
    db
      .select({ id: step.id })
      .from(step)
      .where(
        and(
          inArray(step.buildId, buildIds),
          eq(step.status, 'done'),
          isNotNull(step.checkpointCommit),
        ),
      )
      .all().length > 0;
  return {
    merge: mergeRecord(db, buildIds),
    pushed,
    deployed: false,
    tests: false,
  };
}

export function turnClaimFacts(
  db: Db,
  threadId: string,
  turnPrompt: string | null,
  text: string,
): { facts: TerminalClaimFacts; todoIds: string[] } {
  const todoIds = claimTodoIds(db, threadId, turnPrompt, text);
  return { facts: terminalClaimFacts(db, todoIds), todoIds };
}

const MERGE_STATE_TEXT: Record<MergeRecord, string> = {
  none: '没有发起合并',
  'in-flight': '合并已发起，尚未记录合并完成',
  failed: '合并没有成功，改动没有合并',
  done: '合并步已完成',
};

export function describeFacts(facts: TerminalClaimFacts): string {
  const parts = [MERGE_STATE_TEXT[facts.merge]];
  parts.push(facts.pushed ? '有推送提交' : '没有推送提交的记录');
  return parts.join('；');
}

export class TerminalClaimError extends Error {
  readonly claims: string[];
  constructor(message: string, claims: string[]) {
    super(message);
    this.name = 'TerminalClaimError';
    this.claims = claims;
  }
}

export function assertGroundedClaims(
  db: Db,
  input: { threadId: string; turnPrompt: string | null; text: string },
): void {
  const { facts } = turnClaimFacts(db, input.threadId, input.turnPrompt, input.text);
  const unbacked = unbackedTerminalClaims(input.text, facts);
  if (unbacked.length === 0) return;
  const phrases = [...new Set(unbacked.map((claim) => claim.phrase))];
  throw new TerminalClaimError(
    `这条消息说「${phrases.join('」「')}」，但服务器记录里${describeFacts(facts)}。不要凭请求、计划或任务自己的说法断言结果：改成服务器记录得到的状态（例如「合并已发起，机器执行完我再说结果」），或者把任务报告里的原话标明出处。`,
    phrases,
  );
}

export function rewriteGivenClaims(
  db: Db,
  input: { threadId: string; turnPrompt: string | null; text: string },
): TerminalClaimRewrite {
  const { facts } = turnClaimFacts(db, input.threadId, input.turnPrompt, input.text);
  return rewriteTerminalClaims(input.text, facts);
}

export function stepClaimFacts(
  db: Db,
  stepRow: { buildId: string; prompt: string | null },
): TerminalClaimFacts {
  if (isChiefConversationId(stepRow.buildId))
    return turnClaimFacts(db, stepRow.buildId, stepRow.prompt, '').facts;
  const found = db
    .select({ todoId: build.todoId })
    .from(build)
    .where(eq(build.id, stepRow.buildId))
    .get();
  return found === undefined ? NO_TERMINAL_CLAIM_FACTS : terminalClaimFacts(db, [found.todoId]);
}

const shieldsByDb = new WeakMap<Db, Map<string, ClaimShield>>();

function shieldsOf(db: Db): Map<string, ClaimShield> {
  let map = shieldsByDb.get(db);
  if (map === undefined) {
    map = new Map<string, ClaimShield>();
    shieldsByDb.set(db, map);
  }
  return map;
}

export function shieldFor(db: Db, stepId: string, facts: () => TerminalClaimFacts): ClaimShield {
  const shields = shieldsOf(db);
  const existing = shields.get(stepId);
  if (existing !== undefined) return existing;
  const created = createClaimShield(facts());
  shields.set(stepId, created);
  return created;
}

export function flushShield(db: Db, stepId: string): string {
  const shields = shieldsOf(db);
  const shield = shields.get(stepId);
  if (shield === undefined) return '';
  shields.delete(stepId);
  return shield.flush();
}

export function discardShield(db: Db, stepId: string): void {
  shieldsOf(db).delete(stepId);
}
