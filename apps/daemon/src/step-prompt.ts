import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ClaimedStep } from '@cairn/shared';
import {
  appendBlockerHandoff,
  appendConfirmedPlanNote,
  appendDecisionsNote,
  appendPlanLocationNote,
  appendWorkBranchNote,
  buildPlanFirstRoundInstruction,
  buildTaskPromptText,
  composeTaskPromptWithInstruction,
  conversationBranch,
  isBuildStepKind,
  isIssueSourcedTask,
  PLAN_FILE_NAME,
  parseVerifyPromptMeta,
} from '@cairn/shared';

export function buildTaskPrompt(claimed: ClaimedStep): string {
  const todo = claimed.todo;
  if (!todo) return claimed.instruction ?? '';
  const taskText = appendDecisionsNote(
    appendBlockerHandoff(buildTaskPromptText(todo.title, todo.spec, todo), todo.blockerHandoff),
    todo.decisions,
  );
  const instruction = claimed.instruction ?? null;
  if (instruction !== null && instruction.trim() !== '') {
    return composeTaskPromptWithInstruction(taskText, instruction);
  }
  if (claimed.step.kind === 'plan') {
    return composeTaskPromptWithInstruction(taskText, buildPlanFirstRoundInstruction());
  }
  return taskText;
}

export function carriedAnswers(claimed: ClaimedStep): { requestId: string; text: string }[] {
  const carried = new Set(claimed.answerIds ?? []);
  return (claimed.todo?.decisions ?? [])
    .filter((decision) => carried.has(decision.requestId))
    .map((decision) => ({ requestId: decision.requestId, text: decision.answer }));
}

export function resumeMissNote(sessionId: string, claimed: ClaimedStep): string {
  const prior = claimed.session.priorMachineId;
  if (prior !== undefined && prior !== claimed.step.machineId) {
    return `会话 ${sessionId} 在另一台机器上，本机无法续接。已改开新会话，按原任务继续。`;
  }
  return `本机找不到会话 ${sessionId}，无法续接。已改开新会话，按原任务继续。`;
}

function confirmedPlanFile(plansDir: string, convId: string): string | null {
  const planFile = join(plansDir, convId, PLAN_FILE_NAME);
  try {
    if (!existsSync(planFile)) return null;
    return readFileSync(planFile, 'utf8').trim() !== '' ? planFile : null;
  } catch {
    return null;
  }
}

export function degradedFreshPrompt(
  claimed: ClaimedStep,
  plansDir: string,
  convId: string,
): string {
  let text = buildTaskPrompt(claimed);
  if (isBuildStepKind(claimed.step.kind)) {
    const planFile = confirmedPlanFile(plansDir, convId);
    if (planFile !== null) text = appendConfirmedPlanNote(text, planFile);
  } else if (claimed.step.kind === 'plan') {
    text = appendPlanLocationNote(text, join(plansDir, convId, PLAN_FILE_NAME));
  }
  if (
    (isBuildStepKind(claimed.step.kind) ||
      claimed.step.kind === 'merge' ||
      (claimed.step.kind === 'verify' &&
        parseVerifyPromptMeta(claimed.instruction ?? null)?.evidence !== 'attachments')) &&
    (claimed.project?.repo ?? null) !== null
  ) {
    text = appendWorkBranchNote(
      text,
      conversationBranch(convId),
      claimed.project?.repo?.baseBranch,
    );
  }
  return text;
}

export interface TaskMetaForm {
  vocab: readonly { name: string }[];
}

export function composeTaskMetaInstruction(currentTitle: string, meta?: TaskMetaForm): string {
  if (meta === undefined) {
    return `## 任务元信息\n本任务当前标题是占位截断：「${currentTitle}」。正式开工前，先调用一次 \`set_task_meta\` 工具回填标题：\`title\` = 用不超过 50 个字总结任务正文（平文本，无 markdown，覆盖占位标题）。`;
  }
  const tagInstruction =
    meta.vocab.length > 0
      ? `\`tags\` = 从下面的项目标签词表选贴切的类别（可多选，判不出就不传 \`tags\`）：\n${meta.vocab
          .map((t) => `- ${t.name}`)
          .join('\n')}`
      : '本项目当前没有可用标签，不传 `tags`。';
  return `## 任务元信息\n本任务当前标题是占位截断：「${currentTitle}」。正式开工前，先调用一次 \`set_task_meta\` 工具回填元信息：\`title\` = 用不超过 50 个字总结任务正文（平文本，无 markdown，覆盖占位标题）；${tagInstruction}`;
}

export function taskMetaOpts(
  claimed: Pick<ClaimedStep, 'todo' | 'remoteTools'>,
): { taskMeta: { currentTitle: string; meta?: TaskMetaForm } } | undefined {
  const { todo } = claimed;
  if (!todo) return undefined;
  if (!claimed.remoteTools?.some((tool) => tool.name === 'set_task_meta')) return undefined;
  if (todo.meta?.titleFinal === true || isIssueSourcedTask(todo)) return undefined;
  return {
    taskMeta: {
      currentTitle: todo.title,
      ...(todo.meta !== undefined ? { meta: todo.meta } : {}),
    },
  };
}

export function composeWorkerSystemPrompt(
  description: string | null | undefined,
  memories: readonly { title: string; content: string }[] | undefined,
  opts?: {
    taskMeta?: { currentTitle: string; meta?: TaskMetaForm };
    attachments?: boolean;
    project?: { name: string; instructions?: string | undefined };
  },
): string | undefined {
  const parts: string[] = [];
  if (opts?.attachments) {
    parts.push(
      'For UI tasks, attach light and dark screenshots with `attach_file {path, caption?}` before your final reply. Attach other deliverable files the same way. Attachment tokens are appended to your assistant output automatically.',
    );
  }
  if (description) parts.push(description);
  if (opts?.project?.instructions) {
    parts.push(`## 项目说明（${opts.project.name}）\n${opts.project.instructions}`);
  }
  if (memories && memories.length > 0) {
    parts.push(`## 记忆\n${memories.map((m) => `- ${m.title}：${m.content}`).join('\n')}`);
  }
  if (opts?.taskMeta) {
    parts.push(composeTaskMetaInstruction(opts.taskMeta.currentTitle, opts.taskMeta.meta));
  }
  return parts.length > 0 ? parts.join('\n\n') : undefined;
}
