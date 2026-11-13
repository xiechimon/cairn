import {
  hasBlockingFinding,
  PLAN_PRIOR_ART_RULE,
  planVerificationItems,
  REVIEW_VERDICT_KIND,
  type ReviewVerdict,
  reconcileVerifyVerdict,
  VERIFY_VERDICT_KIND,
  type VerifyVerdict,
} from '@cairn/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { type build, step, todo } from '../db/schema.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { persistGateVerdict, reportedVerdictHeads } from './build-gate-verdict.js';
import { type BuildDeps, type CompleteStepOutcome, enqueueStep } from './builds.js';
import { latestPlanRow } from './plan-auto-confirm.js';
import { getTodo, setTodoPhase } from './todos.js';
import { insertMessageRow } from './transcript.js';

const REVIEW_REVISE_PROMPT = `用户对方案提出审核反馈，结论含 blocking findings。审核结论：<{conclusion}>。\n\nBlocking findings（必须逐条修复）：\n{blockings}\n\n请忠实按反馈调整方案，输出更新后的 plan.md（覆盖 Context/Changes/Edge cases/Verification 四段），并在结尾一句话摘要本次调整了什么。${PLAN_PRIOR_ART_RULE}`;

function enqueueReviewRevision(
  deps: BuildDeps,
  args: { buildId: string; todoId: string; teamId: string; note: string; revisePrompt: string },
): void {
  setTodoPhase(deps, args.todoId, 'planning');
  insertMessageRow(deps, args.buildId, {
    id: newRecordId(),
    role: 'system',
    content: args.note,
    createdAt: nowMs(),
  });
  enqueueStep(deps, args.buildId, 'plan', args.teamId, args.revisePrompt);
}

type StepRow = typeof step.$inferSelect;
type BuildRow = typeof build.$inferSelect;
type TodoRow = typeof todo.$inferSelect;

export function settleReviewStep(
  deps: BuildDeps,
  stepRow: StepRow,
  todoRow: TodoRow,
  buildRow: BuildRow,
  outcome: CompleteStepOutcome,
): void {
  const verdict: ReviewVerdict = outcome.findings ?? {
    conclusion: outcome.findingsError !== undefined ? '判定提取失败' : '审核未返回结论',
    findings: [],
  };
  deps.db
    .update(todo)
    .set({ hasChanges: false, v: todoRow.v + 1 })
    .where(eq(todo.id, todoRow.id))
    .run();
  const updatedTodo = getTodo(deps, todoRow.id);
  if (updatedTodo) deps.hub.publishTodoDoc(updatedTodo.teamId, updatedTodo);
  insertMessageRow(deps, buildRow.id, {
    id: newRecordId(),
    role: 'system',
    content: JSON.stringify({
      kind: REVIEW_VERDICT_KIND,
      stepId: stepRow.id,
      verdict,
      ...(outcome.findingsError !== undefined ? { extractionError: outcome.findingsError } : {}),
    }),
    createdAt: nowMs(),
  });
  persistGateVerdict(deps, stepRow, {
    stepFailed: false,
    extracted: outcome.findings !== undefined,
    blocked: outcome.findings !== undefined && hasBlockingFinding(outcome.findings),
    report:
      outcome.verdictReport ?? reportedVerdictHeads(stepRow, { commit: stepRow.checkpointCommit }),
  });
  if (hasBlockingFinding(verdict)) {
    const revisionInFlight = deps.db
      .select({ id: step.id })
      .from(step)
      .where(
        and(
          eq(step.buildId, stepRow.buildId),
          eq(step.kind, 'plan'),
          inArray(step.status, ['pending', 'claimed']),
        ),
      )
      .get();
    if (revisionInFlight === undefined) {
      const blockings = verdict.findings
        .filter((f) => f.severity === 'blocking')
        .map(
          (f) =>
            `- #${f.id} ${f.summary}${
              f.file !== undefined ? ` (${f.file}${f.line !== undefined ? `:${f.line}` : ''})` : ''
            }`,
        )
        .join('\n');
      const revisePrompt = REVIEW_REVISE_PROMPT.replace(
        '<{conclusion}>',
        verdict.conclusion,
      ).replace('{blockings}', blockings);
      enqueueReviewRevision(deps, {
        buildId: stepRow.buildId,
        todoId: todoRow.id,
        teamId: todoRow.teamId,
        note: `AI 审核检测到 ${blockings.split('\n').length} 处 blocking 风险，已自动入队重规划步`,
        revisePrompt,
      });
    }
  }
}

export function settleVerifyStep(
  deps: BuildDeps,
  stepRow: StepRow,
  buildRow: BuildRow,
  outcome: CompleteStepOutcome,
): void {
  const latestPlan = latestPlanRow(deps, buildRow.id);
  const verdict: VerifyVerdict =
    outcome.verifyVerdict !== undefined
      ? reconcileVerifyVerdict(
          outcome.verifyVerdict,
          planVerificationItems(latestPlan?.content ?? ''),
        )
      : {
          passed: false,
          conclusion: outcome.verifyVerdictError !== undefined ? '判定提取失败' : '验证未返回结论',
          evidence: [],
        };
  insertMessageRow(deps, buildRow.id, {
    id: newRecordId(),
    role: 'system',
    content: JSON.stringify({
      kind: VERIFY_VERDICT_KIND,
      ...(buildRow.evidenceStore === 'attachments' ? { stepId: stepRow.id } : {}),
      verdict,
      ...(outcome.verifyVerdictError !== undefined
        ? { extractionError: outcome.verifyVerdictError }
        : {}),
    }),
    createdAt: nowMs(),
  });
  persistGateVerdict(deps, stepRow, {
    stepFailed: false,
    extracted: outcome.verifyVerdict !== undefined,
    blocked: outcome.verifyVerdict !== undefined && !verdict.passed,
    report:
      outcome.verdictReport ?? reportedVerdictHeads(stepRow, { commit: stepRow.checkpointCommit }),
  });
}
