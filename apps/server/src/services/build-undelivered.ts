import {
  type AcceptanceEvaluation,
  ASK_USER_QUESTION_KIND,
  isBuildStepKind,
  isInfoOutput,
} from '@cairn/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { type build, message, type step, type todo } from '../db/schema.js';
import { nowMs } from '../lib/ids.js';
import type { BuildDeps } from './builds.js';
import { ACCEPTANCE_BLOCKED_PREFIX, writeWorkerQuestion } from './worker-question-store.js';

type BuildRow = typeof build.$inferSelect;

const UNDELIVERED_EXCERPT_MAX = 1_200;

const EXPLICIT_NO_FILE_CHANGE_RE = new RegExp(
  [
    String.raw`\b(?:do\s+not|don['’]t|never)\s+(?:edit|modify|change|touch|write|create|alter|commit)\s+(?:any\s+)?(?:files?|code|the\s+repo(?:sitory)?|anything)\b`,
    String.raw`\b(?:change|edit|modify|touch|make)\s+no\s+(?:file\s+|code\s+|repo(?:sitory)?\s+)?(?:files?|edits?|changes?|modifications?|commits?)\b`,
    String.raw`\b(?:with|without(?:\s+making)?|leave)\s+(?:no|zero)\s+(?:file\s+|code\s+|repo(?:sitory)?\s+)?(?:edits?|changes?|modifications?|commits?)\b`,
    String.raw`\bwithout\s+(?:editing|modifying|changing|touching|writing|creating)\s+(?:any\s+)?(?:files?|code|anything)\b`,
    String.raw`\bno\s+(?:file\s+|code\s+|repo(?:sitory)?\s+)?(?:edits?|changes?|modifications?|commits?)\s+(?:needed|required|requested|expected|allowed|please)\b`,
    '(?:不要|别|无需|不需要|不用|切勿|禁止|不得|不)(?:去)?(?:修改|改动|更改|编辑|写入|新建|创建|改|动)(?:任何)?(?:文件|代码|仓库|源码)',
  ].join('|'),
  'i',
);

const FILE_MUTATION_INTENT_RE = new RegExp(
  [
    String.raw`(?:^|[\s;|&])(?:>|>>)\s*(?!\/dev\/null\b)\S+`,
    String.raw`\b(?:tee|mv|cp|rm|touch|sed\s+-i|patch|git\s+(?:apply|commit|push|merge))\b`,
    String.raw`\b(?:fix|implement|add|create|write|edit|modify|update|refactor|rename|delete|remove|port|copy|migrate|generate|commit|push)\b`,
    '(?:修复|修一下|实现|新增|新建|添加|加上|写入|写一行|修改|改动|更新|重构|重命名|删除|迁移|生成|提交|改成)',
  ].join('|'),
  'i',
);

const READ_ONLY_TASK_RE = new RegExp(
  [
    String.raw`\bread[\s-]*only\b(?!\s+(?:mode|view|flag|state|role|access|permission|toggle|option|field|prop|endpoint|api|page|ui)\b)`,
    '只读(?:验证|检查|核查|核验|巡检|查询|测试|执行|运行|任务|探针|排查)',
    '仅(?:读|查询|检查|验证|运行|执行|回复|回报|输出)',
  ].join('|'),
  'i',
);

const COMMAND_OR_REPLY_ONLY_RE = new RegExp(
  [
    String.raw`\b(?:run|exec(?:ute)?)\b[^\n.!?]*\b(?:and|then)\s+(?:report|echo|reply|print|return|output|show|respond)\b`,
    String.raw`\bsleep\s+\d+\b[^\n.!?]*\b(?:echo|report|reply|output)\b`,
    String.raw`\b(?:run|exec(?:ute)?)\s+(?:the\s+(?:bash|shell)\s+command\s+)?["'\x60]?(?:hostname|uname|whoami|pwd|date|id|uptime|env|sleep\s+\d+|echo\b|node\s+(?:-v|--version)|git\s+(?:log|status|rev-parse|branch|show|diff))\b`,
    String.raw`\b(?:just\s+|directly\s+|only\s+)?reply\s+(?:with|directly)\b`,
    String.raw`(?:运行|执行)[^\n。！？]*(?:并|后|然后)\s*(?:回复|回报|报告|输出|打印|返回)`,
    '直接回复',
    String.raw`\bcall\s+(?:the\s+)?\x60?ask_user\x60?\s+tool\b[\s\S]*\bdo\s+not\s+run\s+any\s+other\s+tool\b`,
  ].join('|'),
  'i',
);

function requestExpectsNoFileChanges(
  todoRow: Pick<typeof todo.$inferSelect, 'title' | 'spec'>,
): boolean {
  const text = [todoRow.title, todoRow.spec]
    .filter((part) => part.trim() !== '')
    .join('\n')
    .replace(/^\s*>\s?/gm, '');
  if (text === '') return false;
  if (EXPLICIT_NO_FILE_CHANGE_RE.test(text)) return true;
  if (FILE_MUTATION_INTENT_RE.test(text)) return false;
  return READ_ONLY_TASK_RE.test(text) || COMMAND_OR_REPLY_ONLY_RE.test(text);
}

type Undelivered = 'no-commits';

export function undeliveredEnd(
  stepRow: typeof step.$inferSelect,
  todoRow: typeof todo.$inferSelect,
  outcome: { hasChanges?: boolean },
): Undelivered | null {
  if (!isBuildStepKind(stepRow.kind) || isInfoOutput(todoRow.output)) return null;
  if (outcome.hasChanges !== false) return null;
  return todoRow.request === null && requestExpectsNoFileChanges(todoRow) ? null : 'no-commits';
}

function spokenText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .flatMap((block: unknown) => {
      if (block === null || typeof block !== 'object') return [];
      const { type, text } = block as { type?: unknown; text?: unknown };
      return type === 'text' && typeof text === 'string' ? [text] : [];
    })
    .join('\n');
}

function lastAgentMessage(deps: BuildDeps, buildId: string): string | null {
  const rows = deps.db
    .select({ content: message.content })
    .from(message)
    .where(and(eq(message.conversationId, buildId), eq(message.role, 'assistant')))
    .orderBy(desc(message.createdAt))
    .all();
  for (const row of rows) {
    const text = spokenText(row.content).trim();
    if (text !== '') return text;
  }
  return null;
}

function excerptOf(text: string | null, missing: string): string {
  if (text === null || text.trim() === '') return missing;
  return text.length > UNDELIVERED_EXCERPT_MAX
    ? `${text.slice(0, UNDELIVERED_EXCERPT_MAX - 1)}…`
    : text;
}

const UNDELIVERED_SUMMARY: Record<Undelivered, string> = {
  'no-commits': 'The step ended without committing anything.',
};

export function askAcceptanceBlockedOnce(
  deps: BuildDeps,
  buildRow: BuildRow,
  stepId: string,
  evaluation: Exclude<AcceptanceEvaluation, { ok: true }>,
): void {
  const requestId = `${ACCEPTANCE_BLOCKED_PREFIX}${stepId}`;
  const ranLine =
    evaluation.checksRan.length > 0
      ? evaluation.checksRan.join(', ')
      : '(no verification commands)';
  writeWorkerQuestion(
    deps,
    buildRow.id,
    requestId,
    {
      kind: ASK_USER_QUESTION_KIND,
      requestId,
      status: 'pending',
      questions: [
        {
          header: 'Acceptance needed',
          question: `${evaluation.summary}\nWhat ran: ${ranLine}\nMissing: ${evaluation.missingLine}\nHow to unblock: ${evaluation.unblockHint}`,
          options: [],
        },
      ],
      answers: null,
    },
    nowMs(),
  );
}

export function askUndeliveredOnce(deps: BuildDeps, buildRow: BuildRow, kind: Undelivered): void {
  const asked = deps.db
    .select({ id: message.id })
    .from(message)
    .where(inArray(message.id, [`no-deliverable-${buildRow.id}`, `no-change-${buildRow.id}`]))
    .get();
  if (asked !== undefined) return;
  const reportLine = excerptOf(buildRow.reportLine, '(no report line)');
  const last = excerptOf(lastAgentMessage(deps, buildRow.id), '(the agent left no message)');
  const requestId = `no-deliverable-${buildRow.id}`;
  writeWorkerQuestion(
    deps,
    buildRow.id,
    requestId,
    {
      kind: ASK_USER_QUESTION_KIND,
      requestId,
      status: 'pending',
      questions: [
        {
          header: 'Not delivered',
          question: `Report line: ${reportLine}\n${UNDELIVERED_SUMMARY[kind]} The agent's last message:\n${last}\nAnswer with what is missing and who supplies it, or say what the task should deliver instead.`,
          options: [],
        },
      ],
      answers: null,
    },
    nowMs(),
  );
}
