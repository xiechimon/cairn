import { z } from 'zod';
import type { GitCredentialSource } from '../git-ops.js';
import type { WorkspaceHookNoteData } from '../protocol/executor.js';

export const WORKSPACE_HOOK_ROW_KIND = 'workspace-hook';
export const GIT_CREDENTIAL_ROW_KIND = 'git-credential-source';
export const BUILD_FAILURE_ROW_KIND = 'build-failure';

const workspaceHookRowSchema = z.object({
  kind: z.literal(WORKSPACE_HOOK_ROW_KIND),
  name: z.string(),
  status: z.enum(['ok', 'failed', 'timeout']),
  exitCode: z.number().int().nullable(),
  ms: z.number().nonnegative(),
  output: z.string(),
  omittedChars: z.number().int().nonnegative(),
});

const gitCredentialRowSchema = z.object({
  kind: z.literal(GIT_CREDENTIAL_ROW_KIND),
  source: z.enum(['integration', 'machine']),
});

const buildFailureRowSchema = z.object({
  kind: z.literal(BUILD_FAILURE_ROW_KIND),
  reason: z.string(),
  files: z.array(z.string()).nullable(),
  fileCount: z.number().int().nonnegative().nullable(),
  commits: z.array(z.string()),
  pr: z.object({ number: z.number().int(), url: z.string().nullable() }).nullable(),
});

const systemRowSchema = z.discriminatedUnion('kind', [
  workspaceHookRowSchema,
  gitCredentialRowSchema,
  buildFailureRowSchema,
]);

export type WorkspaceHookRow = z.infer<typeof workspaceHookRowSchema>;
export type GitCredentialRow = z.infer<typeof gitCredentialRowSchema>;
export type BuildFailureRow = z.infer<typeof buildFailureRowSchema>;
export type SystemRow = z.infer<typeof systemRowSchema>;

export function workspaceHookRowContent(hook: WorkspaceHookNoteData, output = hook.output): string {
  const row: WorkspaceHookRow = {
    kind: WORKSPACE_HOOK_ROW_KIND,
    name: hook.name,
    status: hook.status,
    exitCode: hook.exitCode,
    ms: hook.ms,
    output: output.trimEnd(),
    omittedChars: Math.max(0, hook.totalChars - hook.output.length),
  };
  return JSON.stringify(row);
}

export function gitCredentialRowContent(source: GitCredentialSource): string {
  const row: GitCredentialRow = { kind: GIT_CREDENTIAL_ROW_KIND, source };
  return JSON.stringify(row);
}

export function buildFailureRowContent(args: {
  reason: string;
  commits?: readonly string[];
  files?: readonly string[];
  pr: { number: number; url: string | null } | null;
}): string {
  const row: BuildFailureRow = {
    kind: BUILD_FAILURE_ROW_KIND,
    reason: args.reason,
    files: args.files === undefined ? null : [...args.files],
    fileCount: args.files === undefined ? null : args.files.length,
    commits: [...(args.commits ?? [])],
    pr: args.pr,
  };
  return JSON.stringify(row);
}

const LEGACY_HOOK =
  /^\.agents\/(\S+) hook (?:ok \((\d+)ms\)|timed out after (\d+)s[^\n]*|failed \(exit (-?\d+|null)\))(?:\n([\s\S]*))?$/;
const LEGACY_CREDENTIAL = /^git 凭据来源：(integration|machine)（/;
const LEGACY_FAILURE_HEAD = '构建步兜底报告：';
const LEGACY_REWORK_REASON = '上一轮失败原因：';

const LEGACY_FAILURE_LABELS = ['失败原因：', '已知改动：', 'Commit: ', 'PR：', '下一步：'];

function legacyFailureField(text: string, label: string): string | null {
  const start = text.indexOf(`\n- ${label}`);
  if (start < 0) return null;
  const from = start + label.length + 3;
  const ends = LEGACY_FAILURE_LABELS.filter((other) => other !== label)
    .map((other) => text.indexOf(`\n- ${other}`, from))
    .filter((at) => at >= 0);
  return text.slice(from, ends.length > 0 ? Math.min(...ends) : undefined).trim();
}

function legacySystemRow(text: string): SystemRow | null {
  const hook = LEGACY_HOOK.exec(text);
  if (hook !== null) {
    const exit = hook[4];
    return {
      kind: WORKSPACE_HOOK_ROW_KIND,
      name: hook[1] ?? '',
      status: hook[2] !== undefined ? 'ok' : hook[3] !== undefined ? 'timeout' : 'failed',
      exitCode:
        hook[2] !== undefined ? 0 : exit !== undefined && exit !== 'null' ? Number(exit) : null,
      ms:
        hook[2] !== undefined
          ? Number(hook[2])
          : hook[3] !== undefined
            ? Number(hook[3]) * 1000
            : 0,
      output: (hook[5] ?? '').trimEnd(),
      omittedChars: 0,
    };
  }
  const credential = LEGACY_CREDENTIAL.exec(text);
  if (credential !== null) {
    return { kind: GIT_CREDENTIAL_ROW_KIND, source: credential[1] as GitCredentialSource };
  }
  if (text.startsWith(LEGACY_FAILURE_HEAD)) {
    const files = legacyFailureField(text, '已知改动：');
    const fileList = files === null ? null : /（(.*?)( 等)?）$/.exec(files)?.[1]?.split('、');
    const unrecorded = files === null || files === '没有改动记录';
    const pr = /^#(\d+)(?: (\S+))?$/.exec(legacyFailureField(text, 'PR：') ?? '');
    return {
      kind: BUILD_FAILURE_ROW_KIND,
      reason: legacyFailureField(text, '失败原因：') ?? '',
      files: unrecorded ? null : (fileList ?? []),
      fileCount: unrecorded ? null : Number(/^(\d+) 个文件/.exec(files)?.[1] ?? 0),
      commits: text
        .slice(Math.max(0, text.indexOf('\n- 已知改动：')))
        .split('\n')
        .filter((line) => line.startsWith('- Commit: '))
        .map((line) => line.slice('- Commit: '.length).trim()),
      pr: pr === null ? null : { number: Number(pr[1]), url: pr[2] ?? null },
    };
  }
  return null;
}

export function systemRowOf(content: unknown): SystemRow | null {
  if (typeof content !== 'string') return null;
  if (content.startsWith('{')) {
    try {
      const parsed = systemRowSchema.safeParse(JSON.parse(content));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }
  return legacySystemRow(content);
}

export function reworkNoteWithoutReason(text: string): string {
  const at = text.indexOf(LEGACY_REWORK_REASON);
  return at < 0 ? text : text.slice(0, at);
}
