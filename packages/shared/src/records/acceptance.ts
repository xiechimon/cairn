import { toolResultText } from '../tool-result.js';
import type { ProjectRepoKind } from './project.js';
import { isInfoOutput, type TodoOutputKind } from './todo.js';

export type AcceptanceFailureReason =
  | 'missing-ui-screenshot'
  | 'stale-ui-screenshot'
  | 'fixture-only-screenshot'
  | 'missing-evidence'
  | 'stale-evidence'
  | 'stale-deployed-target'
  | 'unverified-deployed-target'
  | 'unverified-api'
  | 'unverified-cli'
  | 'unverified-doc'
  | 'unverified-deliverable'
  | 'failing-check'
  | 'hollow-claim'
  | 'blocked'
  | 'unpushed'
  | 'unpushed-blocked'
  | 'unpushed-unknown';

export interface AcceptanceAttachment {
  id: string;
  createdBy: string;
  fileName: string;
  mimeType: string;
  sizeBytes?: number | undefined;
  status: string;
  grantId: string;
  createdAt: number;
}

export interface AcceptanceMessage {
  role: 'system' | 'user' | 'assistant';
  content: unknown;
  createdAt: number;
}

export interface EvaluateStepAcceptanceInput {
  output: TodoOutputKind;
  repoKind: ProjectRepoKind | null | undefined;
  hasChanges: boolean | undefined;
  editedPaths: readonly string[];
  messages: readonly AcceptanceMessage[];
  attachments: readonly AcceptanceAttachment[];
  stepIds: readonly string[];
  unpushedCommits?: number | null | undefined;
  expectedCommit?: string | null | undefined;
  report?: string | undefined;
  deliverables?: { files: readonly { name: string }[] } | undefined;
}

export type AcceptanceEvaluation =
  | { ok: true; checksRan: string[] }
  | {
      ok: false;
      retryable: boolean;
      reason: AcceptanceFailureReason;
      checksRan: string[];
      summary: string;
      missing: string;
      missingLine: string;
      unblockHint: string;
    };

const ACCEPTANCE_NUDGE_HEAD = '[cairn acceptance check]';
const MISSING_LINE_MAX_CHARS = 140;

const EDIT_TOOL_NAMES = new Set([
  'edit',
  'write',
  'write_file',
  'edit_file',
  'multiedit',
  'notebookedit',
  'apply_patch',
  'replace_file_content',
  'multi_replace_file_content',
  'str_replace_editor',
  'create_file',
]);

const WRITE_ONLY_TOOL_NAMES = new Set(['write', 'write_file', 'create_file']);

const READ_TOOL_NAMES = new Set(['read', 'read_file', 'view_file']);

const COMMAND_TOOL_NAMES = new Set(['bash', 'shell', 'run_command', 'exec', 'user_computer_shell']);

const UI_EXT_RE = /\.(?:tsx|jsx|css|scss|less|html|svelte|vue)$/i;
const DOC_EXT_RE = /\.(?:md|mdx|txt|json|ya?ml|toml|csv|sql|pdf|pptx|docx|html)$/i;
const TEST_OR_FIXTURE_RE = /(?:^|\/)(?:test|tests|__tests__|e2e|fixtures?)\/|\.(?:test|spec)\./i;

const BLOCKER_RE =
  /spawn\s+EPERM|operation not permitted|\bEACCES\b|\bEROFS\b|sandbox(?:\s+is)?\s+block|missing credentials|cannot bind|could not run locally|\b(?:waiting for CI|deferred to CI)\b/i;

const PUSH_AUTH_BLOCKER_RE =
  /authentication failed|permission denied|could not read username|\bHTTP\s+(?:401|403)\b|push declined|remote:\s*permission|GH_TOKEN.*missing|missing.*credentials/i;

const SHELL_WRITE_RE = /(?:^|[;&|]\s*)(?:tee|mv|cp|rm|sed\s+-i|patch|git\s+apply)\b|(?:>|>>)\s*\S+/;

const LINT_OR_STATIC_ONLY_RE = /\b(?:biome|eslint|prettier|tsc|typecheck|oxlint|lint)\b/i;

const TRIVIAL_READONLY_CMD_RE =
  /^\s*(?:git\s+(?:status|diff|log|show|branch|rev-parse|remote)|ls|pwd|which|echo)\b[^;&|\n]*$/;

const UNIT_ONLY_TEST_RE = /\bunit(?:\.(?:test|spec))?\b/i;

const API_ACCEPTANCE_CMD_RE =
  /\b(?:curl|wget|http:\/\/|https:\/\/|fetch\(|supertest|inject|playwright|vitest|node\s|tsx\s|python|pytest|cargo\s+(?:test|run)|go\s+(?:test|run)|pnpm\s+(?:test|exec)|npm\s+test|tsx)\b/i;

const FAILED_OUTPUT_RE =
  /\b(?:exit(?:ed with)? code|exit status|status)\s+[1-9]\d*|command failed|^error:\s/im;

const ASSERTION_OR_HTTP5XX_RE = /\bAssertionError\b|^\s*FAIL\s+|HTTP\/[12](?:\.\d)?\s+5\d\d\b/im;

const HEALTH_PATH_FILE_RE = /(?:^|\/|[-_.])(?:health|healthz|ping|ready)(?:[-_.]|\/|$)/i;
const HTTP_URL_OR_API_PATH_RE = /https?:\/\/[^\s'"`]+|\/api\/[^\s'"`]+/gi;
const HEALTH_ENDPOINT_RE = /\/(?:health|healthz|ping|ready)(?:[/?#]|$)/i;
const REMOTE_URL_RE =
  /https?:\/\/(?!(?:127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\])(?::|\/|$))[^\s'"`]+/i;
const DEPLOY_CLAIM_RE =
  /\b(?:verified\s+in\s+prod(?:uction)?|deployed\s+to\s+prod(?:uction)?|checked\s+deployed\s+target)\b|已在生产(?:环境)?验证/i;
const DEPLOYED_SHA_PATTERNS = [
  /"deployed"\s*:\s*\{[^}]*"sha"\s*:\s*"([0-9a-f]{7,64})"/gi,
  /"(?:deployedSha|deployed_sha)"\s*:\s*"([0-9a-f]{7,64})"/gi,
  /\bDEPLOYED_SHA\s*=\s*["']?([0-9a-f]{7,64})["']?/gi,
];

const FIXTURE_LABEL_RE = /\b(?:fixture|mock|storybook)\b/i;
const LIVE_LABEL_RE = /\b(?:live|running|real|prod|app)\b/i;

const SCRATCH_OR_TMP_RE = /(?:^|\/)scratch\/|^\/(?:private\/)?tmp\//i;

const PATCH_PATH_RE = /^\*\*\*\s+(?:Update|Add|Delete)\s+File:\s+(.+)$/gm;

interface ParsedToolCall {
  idx: number;
  createdAt: number;
  name: string;
  args: Record<string, unknown>;
  resultText: string;
  isError: boolean;
}

function sanitizeMissingLine(raw: string): string {
  const collapsed = raw
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (collapsed.length <= MISSING_LINE_MAX_CHARS) return collapsed;
  return `${collapsed.slice(0, MISSING_LINE_MAX_CHARS - 1).trimEnd()}…`;
}

export function parseMissingEvidenceLine(text: string): string | null {
  const match = /^Missing(?:\s+real\s+acceptance)?:\s*(.+)$/im.exec(text);
  if (match?.[1] === undefined) return null;
  const clean = sanitizeMissingLine(match[1]);
  return clean === '' ? null : clean;
}

function normalizedToolName(raw: string): string {
  const lower = raw.toLowerCase();
  const colonAt = lower.lastIndexOf(':');
  const bare = colonAt === -1 ? lower : lower.slice(colonAt + 1);
  return bare.replace(/^mcp__(?:[^_]+__)+|^mcp_cairn_/, '');
}

function asRecord(val: unknown): Record<string, unknown> {
  return val !== null && typeof val === 'object' && !Array.isArray(val)
    ? (val as Record<string, unknown>)
    : {};
}

function messageTextOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .flatMap((block) => {
      if (block === null || typeof block !== 'object') return [];
      const b = block as { type?: unknown; text?: unknown };
      return b.type === 'text' && typeof b.text === 'string' ? [b.text] : [];
    })
    .join('\n');
}

function parsedPathsFromToolArgs(name: string, args: Record<string, unknown>): string[] {
  const paths: string[] = [];
  for (const key of [
    'path',
    'file_path',
    'filePath',
    'target_file',
    'TargetFile',
    'Path',
  ] as const) {
    const val = args[key];
    if (typeof val === 'string' && val.trim() !== '') paths.push(val.trim());
  }
  if (Array.isArray(args.files)) {
    for (const item of args.files) {
      if (typeof item === 'string' && item.trim() !== '') paths.push(item.trim());
      else if (item !== null && typeof item === 'object') {
        const p = (item as { path?: unknown }).path;
        if (typeof p === 'string' && p.trim() !== '') paths.push(p.trim());
      }
    }
  }
  if (name === 'apply_patch') {
    for (const key of ['patch', 'patchText', 'input', 'diff'] as const) {
      const text = args[key];
      if (typeof text !== 'string') continue;
      for (const match of text.matchAll(PATCH_PATH_RE)) {
        const p = match[1]?.trim();
        if (p) paths.push(p);
      }
    }
  }
  return paths;
}

function parseCallsAndText(messages: readonly AcceptanceMessage[]) {
  const calls: ParsedToolCall[] = [];
  const texts: { idx: number; createdAt: number; text: string }[] = [];
  for (let idx = 0; idx < messages.length; idx += 1) {
    const msg = messages[idx];
    if (msg?.role !== 'assistant') continue;
    const raw = msg.content;
    if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
      const obj = raw as { kind?: unknown; call?: unknown };
      if (obj.kind === 'toolcall' && obj.call !== null && typeof obj.call === 'object') {
        const call = obj.call as {
          name?: unknown;
          arguments?: unknown;
          result?: unknown;
          isError?: unknown;
        };
        if (typeof call.name === 'string') {
          const resultStr = toolResultText(call.result) ?? '';
          calls.push({
            idx,
            createdAt: msg.createdAt,
            name: normalizedToolName(call.name),
            args: asRecord(call.arguments),
            resultText: resultStr,
            isError: call.isError === true || FAILED_OUTPUT_RE.test(resultStr),
          });
        }
        continue;
      }
    }
    const text = messageTextOf(raw).trim();
    if (text !== '') texts.push({ idx, createdAt: msg.createdAt, text });
  }
  return { calls, texts };
}

function commandOfCall(args: Record<string, unknown>): string {
  for (const key of ['command', 'CommandLine', 'cmd', 'script'] as const) {
    if (typeof args[key] === 'string') return args[key] as string;
  }
  return '';
}

function isMutatingCall(call: ParsedToolCall): boolean {
  if (EDIT_TOOL_NAMES.has(call.name)) return true;
  if (COMMAND_TOOL_NAMES.has(call.name)) {
    const cleaned = commandOfCall(call.args)
      .replace(/(?:^|\s)\d*>&\d+(?=\s|$|;|&|\|)/g, ' ')
      .replace(/(?:^|\s)\d*>\s*\/dev\/null(?=\s|$|;|&|\|)/g, ' ');
    return SHELL_WRITE_RE.test(cleaned);
  }
  return false;
}

function isLintOnlyCommand(cmd: string): boolean {
  return (
    LINT_OR_STATIC_ONLY_RE.test(cmd) &&
    !/\b(?:curl|http|fetch|vitest|playwright|node\s|tsx\s|python|pytest|cargo\s+(?:test|run)|go\s+(?:test|run)|pnpm\s+(?:test|exec)|npm\s+test)\b/i.test(
      cmd,
    )
  );
}

function isMeaningfulPassCommand(cmd: string): boolean {
  return !isLintOnlyCommand(cmd) && !TRIVIAL_READONLY_CMD_RE.test(cmd);
}

function isApiAcceptanceCommand(cmd: string): boolean {
  if (
    UNIT_ONLY_TEST_RE.test(cmd) &&
    !/\b(?:curl|http:\/\/|https:\/\/|fetch\(|inject)\b/i.test(cmd)
  ) {
    return false;
  }
  return API_ACCEPTANCE_CMD_RE.test(cmd);
}

function isHealthOnlyProbeCommand(cmd: string): boolean {
  if (/\b(?:vitest|playwright|pytest|supertest|inject)\b/i.test(cmd)) return false;
  const targets = [...cmd.matchAll(HTTP_URL_OR_API_PATH_RE)].map((m) => m[0]);
  if (targets.length === 0) return false;
  return targets.every((target) => HEALTH_ENDPOINT_RE.test(target));
}

function extractDeployedShas(text: string): string[] {
  const shas: string[] = [];
  for (const pattern of DEPLOYED_SHA_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const sha = match[1]?.toLowerCase();
      if (sha !== undefined) shas.push(sha);
    }
  }
  return shas;
}

function shaMatchesExpected(observed: string, expected: string): boolean {
  const a = observed.toLowerCase();
  const b = expected.toLowerCase();
  return a.startsWith(b) || b.startsWith(a);
}

function isUiPath(path: string): boolean {
  if (TEST_OR_FIXTURE_RE.test(path)) return false;
  return (
    UI_EXT_RE.test(path) ||
    path.startsWith('apps/web/src/') ||
    path.startsWith('apps/desktop/src/') ||
    path.startsWith('site/src/')
  );
}

function isApiPath(path: string): boolean {
  if (TEST_OR_FIXTURE_RE.test(path)) return false;
  return (
    path.startsWith('apps/server/src/') ||
    /(?:^|\/)(?:routes?|api|handlers?|controllers?)\b/i.test(path)
  );
}

function isCliPath(path: string): boolean {
  if (TEST_OR_FIXTURE_RE.test(path)) return false;
  return (
    path.startsWith('scripts/') ||
    path.startsWith('apps/cli/') ||
    path.startsWith('apps/daemon/src/') ||
    path.startsWith('bin/')
  );
}

function isDocPath(path: string): boolean {
  return DOC_EXT_RE.test(path) || path.startsWith('docs/');
}

function stepScopedAttachments(
  attachments: readonly AcceptanceAttachment[],
  stepIds: readonly string[],
): AcceptanceAttachment[] {
  const stepSet = new Set(stepIds);
  return attachments.filter((att) => {
    if (att.createdBy.startsWith('step:') && stepSet.has(att.createdBy.slice(5))) return true;
    for (const id of stepIds) {
      if (att.grantId.startsWith(`deliverable:${id}:`)) return true;
    }
    return false;
  });
}

function hasPositiveSize(att: AcceptanceAttachment): boolean {
  return typeof att.sizeBytes === 'number' && att.sizeBytes > 0;
}

function attachmentMatchesCall(att: AcceptanceAttachment, call: ParsedToolCall): boolean {
  const p = parsedPathsFromToolArgs(call.name, call.args)[0] ?? '';
  const base = p.split('/').pop() ?? p;
  return base !== '' && (base === att.fileName || att.fileName.endsWith(base));
}

function isFreshAttachment(
  att: AcceptanceAttachment,
  lastEditIdx: number,
  lastEditAt: number,
  allAttachCalls: readonly ParsedToolCall[],
  postEditAttachCalls: readonly ParsedToolCall[],
): boolean {
  if (lastEditIdx === -1) return true;
  if (postEditAttachCalls.some((c) => attachmentMatchesCall(att, c))) return true;
  if (allAttachCalls.some((c) => attachmentMatchesCall(att, c))) return false;
  return att.createdAt > lastEditAt;
}

function failResult(
  reason: AcceptanceFailureReason,
  retryable: boolean,
  checksRan: string[],
  summary: string,
  missing: string,
  unblockHint: string,
): AcceptanceEvaluation {
  return {
    ok: false,
    retryable,
    reason,
    checksRan,
    summary,
    missing,
    missingLine: sanitizeMissingLine(missing),
    unblockHint,
  };
}

export function extractEditedPathsFromMessages(messages: readonly AcceptanceMessage[]): string[] {
  const { calls } = parseCallsAndText(messages);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const call of calls) {
    if (!EDIT_TOOL_NAMES.has(call.name)) continue;
    for (const p of parsedPathsFromToolArgs(call.name, call.args)) {
      if (!seen.has(p)) {
        seen.add(p);
        out.push(p);
      }
    }
  }
  return out;
}

export function buildAcceptanceNudgePrompt(
  evaluation: Exclude<AcceptanceEvaluation, { ok: true }>,
): string {
  return [
    ACCEPTANCE_NUDGE_HEAD,
    evaluation.summary,
    `Missing real acceptance: ${evaluation.missingLine}`,
    `Required next step: ${evaluation.unblockHint}`,
    'Verify the running or deployed target in this same session, walk the changed behavior, and attach proof via `attach_file` (screenshot, redacted request/response, DB row, or run output). If genuinely blocked by the environment, call `ask_user` stating what ran, what is missing, and how to unblock.',
  ].join('\n\n');
}

export function isAcceptanceNudgePrompt(prompt: string | null | undefined): boolean {
  return typeof prompt === 'string' && prompt.startsWith(ACCEPTANCE_NUDGE_HEAD);
}

export function evaluateStepAcceptance(input: EvaluateStepAcceptanceInput): AcceptanceEvaluation {
  const { calls, texts } = parseCallsAndText(input.messages);
  const cmdCalls = calls.filter((c) => COMMAND_TOOL_NAMES.has(c.name));
  const attachCalls = calls.filter((c) => c.name === 'attach_file');
  const readCalls = calls.filter((c) => READ_TOOL_NAMES.has(c.name));
  const checksRan = cmdCalls.map((c) => commandOfCall(c.args)).filter((s) => s !== '');

  if (isInfoOutput(input.output)) {
    const writtenFiles = new Map<string, number>();
    for (const call of calls) {
      if (
        !call.isError &&
        (WRITE_ONLY_TOOL_NAMES.has(call.name) || EDIT_TOOL_NAMES.has(call.name))
      ) {
        for (const p of parsedPathsFromToolArgs(call.name, call.args)) {
          if (!SCRATCH_OR_TMP_RE.test(p)) writtenFiles.set(p, call.idx);
        }
      }
    }
    const deliverableFiles = [...writtenFiles.entries()].filter(([filePath]) =>
      /(?:^|\/)(?:report\.md|deliverables\/)|\.(?:md|html|pdf|pptx|docx|xlsx|csv|png|jpe?g|webp)$/i.test(
        filePath,
      ),
    );
    if (deliverableFiles.length > 0) {
      const lastDeliverableIdx = Math.max(...deliverableFiles.map(([, idx]) => idx));
      const postDeliverableCmd = cmdCalls.findLast(
        (c) =>
          c.idx > lastDeliverableIdx &&
          (c.isError || isMeaningfulPassCommand(commandOfCall(c.args))),
      );
      if (postDeliverableCmd?.isError && !BLOCKER_RE.test(postDeliverableCmd.resultText)) {
        return failResult(
          'failing-check',
          true,
          checksRan,
          'The last verification command exited with an error.',
          'A passing verification command after fixing the failure.',
          'Fix the failing check and re-run it before submitting.',
        );
      }
    }
    const extraDeliverables = (input.deliverables?.files ?? [])
      .map((f) => f.name)
      .filter((name) => {
        if (SCRATCH_OR_TMP_RE.test(name)) return false;
        const base = name.split('/').pop() ?? name;
        return !deliverableFiles.some(
          ([wp]) => wp === name || wp.endsWith(`/${base}`) || wp === base,
        );
      });
    if (deliverableFiles.length > 0 || extraDeliverables.length > 0) {
      const checkedAfterWrite = deliverableFiles.every(([filePath, writeIdx]) => {
        const base = filePath.split('/').pop() ?? filePath;
        const readAfter = readCalls.some(
          (r) =>
            !r.isError &&
            r.idx > writeIdx &&
            parsedPathsFromToolArgs(r.name, r.args).some(
              (rp) => rp === filePath || rp.endsWith(`/${base}`) || rp === base,
            ),
        );
        const cmdAfter = cmdCalls.some(
          (c) =>
            !c.isError &&
            c.idx > writeIdx &&
            isMeaningfulPassCommand(commandOfCall(c.args)) &&
            commandOfCall(c.args).includes(base),
        );
        return readAfter || cmdAfter;
      });
      const checkedExtraDeliverables = extraDeliverables.every((name) => {
        const base = name.split('/').pop() ?? name;
        if (base === 'report.md' && cmdCalls.length === 0) return true;
        const readMatched = readCalls.some(
          (r) =>
            !r.isError &&
            parsedPathsFromToolArgs(r.name, r.args).some(
              (rp) => rp === name || rp.endsWith(`/${base}`) || rp === base,
            ),
        );
        if (readMatched) return true;
        const inspectCmds = cmdCalls.filter(
          (c) => !c.isError && commandOfCall(c.args).includes(base),
        );
        return inspectCmds.some((c) =>
          /\b(?:pdftotext|pdfinfo|cat|head|tail|file|open)\b/i.test(commandOfCall(c.args)),
        );
      });
      if (!checkedAfterWrite || !checkedExtraDeliverables) {
        return failResult(
          'unverified-deliverable',
          true,
          checksRan,
          'Generated deliverable files were written without opening and verifying them.',
          'Open and check each generated report or deliverable file before calling `submit_report`.',
          'Read back the generated report/deliverables and verify their contents.',
        );
      }
    }
    return { ok: true, checksRan };
  }

  if (input.repoKind === 'github') {
    if (input.unpushedCommits === null) {
      return failResult(
        'unpushed-unknown',
        false,
        checksRan,
        'Could not confirm whether commits on this GitHub workspace were pushed.',
        'Remote push state verification (`git rev-list`) failed or was unavailable.',
        'Verify git remote connectivity/credentials and ensure commits are pushed.',
      );
    }
    if (typeof input.unpushedCommits === 'number' && input.unpushedCommits > 0) {
      const hasAuthErr =
        cmdCalls.some((c) => c.isError && PUSH_AUTH_BLOCKER_RE.test(c.resultText)) ||
        texts.some((t) => PUSH_AUTH_BLOCKER_RE.test(t.text));
      if (hasAuthErr) {
        return failResult(
          'unpushed-blocked',
          false,
          checksRan,
          `${input.unpushedCommits} commit(s) remain unpushed locally due to a git push/auth failure.`,
          'Push commits to the GitHub remote branch.',
          'Provide or refresh git push credentials on the runner, then reply to push the branch.',
        );
      }
      return failResult(
        'unpushed',
        true,
        checksRan,
        `${input.unpushedCommits} local commit(s) are still unpushed on this GitHub task.`,
        'Push local commits to the remote work branch.',
        'Push the branch commits to origin so the work is not stranded locally.',
      );
    }
  }

  let lastBlockerIdx = -1;
  let lastBlockerText = '';
  for (const call of calls) {
    const combined = `${call.resultText}\n${commandOfCall(call.args)}`;
    if (call.isError && BLOCKER_RE.test(combined)) {
      lastBlockerIdx = call.idx;
      lastBlockerText = call.resultText || 'Environment blocker';
    }
  }
  for (const t of texts) {
    if (BLOCKER_RE.test(t.text) && t.idx > lastBlockerIdx) {
      lastBlockerIdx = t.idx;
      lastBlockerText = t.text;
    }
  }

  let lastEditIdx = -1;
  let lastEditAt = -1;
  for (const call of calls) {
    if (isMutatingCall(call)) {
      lastEditIdx = call.idx;
      lastEditAt = Math.max(lastEditAt, call.createdAt);
    }
  }

  const postBlockerPass =
    lastBlockerIdx !== -1 &&
    (cmdCalls.some(
      (c) => c.idx > lastBlockerIdx && !c.isError && !isLintOnlyCommand(commandOfCall(c.args)),
    ) ||
      attachCalls.some((c) => c.idx > lastBlockerIdx && !c.isError));
  if (lastBlockerIdx !== -1 && !postBlockerPass) {
    return failResult(
      'blocked',
      false,
      checksRan,
      `Real acceptance was blocked (${lastBlockerText.slice(0, 200)}).`,
      'A passing real verification run without environment blockers.',
      'Resolve the environment/sandbox blocker or run verification on an unblocked runner.',
    );
  }

  const effectivePaths =
    input.editedPaths.length > 0
      ? input.editedPaths
      : extractEditedPathsFromMessages(input.messages);
  const madeCodeOrDocEdits = effectivePaths.length > 0 || input.hasChanges === true;

  if (!madeCodeOrDocEdits) {
    const lastCmd = cmdCalls.findLast(
      (c) => c.isError || isMeaningfulPassCommand(commandOfCall(c.args)),
    );
    if (lastCmd?.isError) {
      return failResult(
        'failing-check',
        true,
        checksRan,
        `Command "${commandOfCall(lastCmd.args)}" failed.`,
        'A passing verification command.',
        'Resolve the command error and re-run it cleanly.',
      );
    }
    if (calls.length === 0 && texts.length > 0) {
      return failResult(
        'hollow-claim',
        true,
        checksRan,
        'Assistant reported results without executing any verification tools.',
        'At least one real read, command, or probe tool call verifying the claim.',
        'Run the actual check or file read before finishing.',
      );
    }
    return { ok: true, checksRan };
  }

  const postEditCmds = cmdCalls.filter((c) => c.idx > lastEditIdx);
  const lastPostEditCmd = postEditCmds.findLast(
    (c) => c.isError || isMeaningfulPassCommand(commandOfCall(c.args)),
  );
  if (
    lastPostEditCmd !== undefined &&
    (lastPostEditCmd.isError || ASSERTION_OR_HTTP5XX_RE.test(lastPostEditCmd.resultText))
  ) {
    return failResult(
      'failing-check',
      true,
      checksRan,
      `Post-edit command "${commandOfCall(lastPostEditCmd.args)}" failed.`,
      'All post-edit verification checks must pass without errors or 5xx responses.',
      'Fix the failure and re-run verification after the last edit.',
    );
  }

  const expectedCommit = input.expectedCommit?.trim() ?? '';
  const hasExpectedCommit = /^[0-9a-f]{7,64}$/i.test(expectedCommit);
  if (hasExpectedCommit) {
    const passingPostCmds = postEditCmds.filter((c) => !c.isError);
    const observedShas = passingPostCmds.flatMap((c) => extractDeployedShas(c.resultText));
    if (
      observedShas.length > 0 &&
      !observedShas.some((sha) => shaMatchesExpected(sha, expectedCommit))
    ) {
      return failResult(
        'stale-deployed-target',
        true,
        checksRan,
        'The deployed target reported an older commit SHA than the task change.',
        'Deployed target is running an older commit; wait for deploy and re-verify',
        'Wait for the new commit to deploy, then re-verify the deployed target and attach fresh proof.',
      );
    }
    const hitsRemoteOrDeployApi = passingPostCmds.some((c) => {
      const cmd = commandOfCall(c.args);
      return REMOTE_URL_RE.test(cmd) || /\/api\/server\/deploy\b/i.test(cmd);
    });
    const claimsProdVerify =
      texts.some((t) => t.idx > lastEditIdx && DEPLOY_CLAIM_RE.test(t.text)) ||
      attachCalls.some(
        (c) =>
          c.idx > lastEditIdx &&
          typeof c.args.caption === 'string' &&
          DEPLOY_CLAIM_RE.test(c.args.caption),
      );
    if (hitsRemoteOrDeployApi || claimsProdVerify) {
      const expectedPrefix = expectedCommit.slice(0, 7).toLowerCase();
      const observedExpected =
        observedShas.some((sha) => shaMatchesExpected(sha, expectedCommit)) ||
        passingPostCmds.some((c) => c.resultText.toLowerCase().includes(expectedPrefix));
      if (!observedExpected) {
        return failResult(
          'unverified-deployed-target',
          true,
          checksRan,
          'Deployed target verification requires observing the expected commit SHA on the target.',
          'Claimed or probed deployed target without observing the expected commit SHA',
          'Check the target deployed SHA (for example via `/api/server/deploy` or version endpoint) and re-run verification.',
        );
      }
    }
  }

  const passingPostEditAnyCmds = postEditCmds.filter(
    (c) => !c.isError && isMeaningfulPassCommand(commandOfCall(c.args)),
  );
  const passingPostEditRuntimeCmds = postEditCmds.filter(
    (c) => !c.isError && isApiAcceptanceCommand(commandOfCall(c.args)),
  );

  const scoped = stepScopedAttachments(input.attachments, input.stepIds);
  const postEditAttachCalls = attachCalls.filter((c) => c.idx > lastEditIdx && !c.isError);
  const imageAttachments = scoped.filter((a) => a.mimeType.startsWith('image/'));
  const readyImages = imageAttachments.filter(
    (a) => (a.status === 'ready' || a.status === 'received') && hasPositiveSize(a),
  );

  if (effectivePaths.some(isUiPath)) {
    if (readyImages.length === 0) {
      const failedAttach = attachCalls.findLast((c) => c.isError);
      if (failedAttach && BLOCKER_RE.test(failedAttach.resultText)) {
        return failResult(
          'blocked',
          false,
          checksRan,
          `Screenshot upload was blocked (${failedAttach.resultText}).`,
          'Non-empty live UI screenshot via `attach_file`.',
          'Unblock the runner environment and attach a live UI screenshot.',
        );
      }
      return failResult(
        'missing-ui-screenshot',
        true,
        checksRan,
        'UI files were edited without a non-empty uploaded UI screenshot.',
        'Run the app, inspect it visually, and attach a non-empty live screenshot via `attach_file`.',
        'Start the app, take a screenshot of the live UI, and attach it with `attach_file`.',
      );
    }

    const freshReadyImages = readyImages.filter((img) =>
      isFreshAttachment(img, lastEditIdx, lastEditAt, attachCalls, postEditAttachCalls),
    );
    if (freshReadyImages.length === 0) {
      return failResult(
        'stale-ui-screenshot',
        true,
        checksRan,
        'All attached UI screenshots pre-date the last edit.',
        'A fresh live screenshot taken AFTER the last edit.',
        'Re-run the app after the last edit and attach a fresh screenshot via `attach_file`.',
      );
    }

    const passingAttachCalls = attachCalls.filter((c) => !c.isError);
    const hasFreshLiveShot = freshReadyImages.some((img) => {
      const matchedCalls = passingAttachCalls.filter((c) => attachmentMatchesCall(img, c));
      const fallbackCalls =
        matchedCalls.length > 0
          ? matchedCalls
          : readyImages.length === 1
            ? postEditAttachCalls.length > 0
              ? postEditAttachCalls
              : passingAttachCalls
            : [];
      const labels = [
        img.fileName,
        ...fallbackCalls
          .flatMap((c) => [c.args.caption, c.args.path])
          .filter((v): v is string => typeof v === 'string'),
      ];
      const hasFixture = labels.some((l) => FIXTURE_LABEL_RE.test(l));
      const hasLive = labels.some((l) => LIVE_LABEL_RE.test(l));
      return !hasFixture || hasLive;
    });
    if (!hasFreshLiveShot) {
      return failResult(
        'fixture-only-screenshot',
        true,
        checksRan,
        'Only fixture/storybook screenshots were attached for a UI change.',
        'A screenshot of the live running application.',
        'Run the live app (not fixture/storybook only) and attach a live screenshot via `attach_file`.',
      );
    }
    if (passingPostEditAnyCmds.length === 0) {
      return failResult(
        'missing-ui-screenshot',
        true,
        checksRan,
        'UI screenshot was attached without running the app or a verification check after the last edit.',
        'Run the app or UI check after your last edit and attach a fresh live screenshot.',
        'Exercise the updated UI after the last edit, then attach the fresh screenshot via `attach_file`.',
      );
    }
  }

  const apiPaths = effectivePaths.filter(isApiPath);
  if (apiPaths.length > 0) {
    const editsNonHealthApi = apiPaths.some((p) => !HEALTH_PATH_FILE_RE.test(p));
    const meaningfulApiProbes = editsNonHealthApi
      ? passingPostEditRuntimeCmds.filter((c) => !isHealthOnlyProbeCommand(commandOfCall(c.args)))
      : passingPostEditRuntimeCmds;
    if (meaningfulApiProbes.length === 0) {
      return failResult(
        'unverified-api',
        true,
        checksRan,
        editsNonHealthApi && passingPostEditRuntimeCmds.length > 0
          ? 'Non-health API code was edited, but only a /health endpoint was probed.'
          : 'Server/API code was edited without a passing runtime request probe after the last edit.',
        editsNonHealthApi
          ? 'A passing request probe exercising the changed route/handler (not /health only).'
          : 'A passing HTTP/handler probe or server runtime check after the last edit.',
        'Send a real request to the changed endpoint after the last edit and attach the proof via `attach_file`.',
      );
    }
  }

  if (effectivePaths.some(isCliPath) && passingPostEditAnyCmds.length === 0) {
    return failResult(
      'unverified-cli',
      true,
      checksRan,
      'CLI/daemon/script code was edited without executing it after the last edit.',
      'A passing real command run after the last edit.',
      'Execute the edited CLI/script command after the last edit and attach its output via `attach_file`.',
    );
  }

  const docPaths = effectivePaths.filter(isDocPath);
  const docOnly =
    docPaths.length > 0 && effectivePaths.every((p) => isDocPath(p) || TEST_OR_FIXTURE_RE.test(p));
  if (docOnly) {
    const docChecked =
      passingPostEditAnyCmds.length > 0 ||
      readCalls.some(
        (r) =>
          !r.isError &&
          r.idx > lastEditIdx &&
          parsedPathsFromToolArgs(r.name, r.args).some((rp) =>
            docPaths.some((dp) => rp === dp || dp.endsWith(rp) || rp.endsWith(dp)),
          ),
      );
    if (!docChecked) {
      return failResult(
        'unverified-doc',
        true,
        checksRan,
        'Document or config files were edited without opening/checking them after the last edit.',
        'Read back the modified artifact or run its validator after the last edit.',
        'Open and verify the modified artifact (or run its validator) after your last edit.',
      );
    }
    return { ok: true, checksRan };
  }

  if (effectivePaths.length === 0) {
    return { ok: true, checksRan };
  }

  if (
    !effectivePaths.some(isUiPath) &&
    apiPaths.length === 0 &&
    !effectivePaths.some(isCliPath) &&
    passingPostEditAnyCmds.length === 0
  ) {
    return failResult(
      'unverified-cli',
      true,
      checksRan,
      'Code files were edited without a passing verification command after the last edit.',
      'A passing verification command after the last edit.',
      'Run the verification check after the last edit and attach proof via `attach_file`.',
    );
  }

  const readyEvidence = scoped.filter(
    (a) => (a.status === 'ready' || a.status === 'received') && hasPositiveSize(a),
  );
  const freshReadyEvidence = readyEvidence.filter((att) =>
    isFreshAttachment(att, lastEditIdx, lastEditAt, attachCalls, postEditAttachCalls),
  );
  if (freshReadyEvidence.length === 0) {
    const failedAttach = attachCalls.findLast((c) => c.isError);
    if (failedAttach && BLOCKER_RE.test(failedAttach.resultText)) {
      return failResult(
        'blocked',
        false,
        checksRan,
        `Evidence upload was blocked (${failedAttach.resultText}).`,
        'Non-empty verification proof attached via `attach_file`.',
        'Unblock the runner environment and attach verification proof via `attach_file`.',
      );
    }
    if (readyEvidence.length > 0) {
      return failResult(
        'stale-evidence',
        true,
        checksRan,
        'All attached verification evidence pre-dates the last edit.',
        'Fresh verification proof attached AFTER the last edit via `attach_file`.',
        'Re-run the target check after the last edit and attach fresh proof via `attach_file`.',
      );
    }
    return failResult(
      'missing-evidence',
      true,
      checksRan,
      'Code changes were verified without attaching non-empty proof via `attach_file`.',
      'Non-empty proof (screenshot, request/response, DB row, or run output) attached via `attach_file`.',
      'Save redacted request/response, DB row, or command output after the last edit and attach it via `attach_file`.',
    );
  }

  return { ok: true, checksRan };
}
