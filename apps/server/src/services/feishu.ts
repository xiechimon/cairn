import type { SecretBox, UserRecord } from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, feishuBinding, secret, todo, user } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { newRecordId } from '../lib/ids.js';
import { applyBuildStepAction, type BuildDeps, NotFoundError, requestMerge } from './builds.js';
import { setFeishuReviewListener } from './feishu-hook.js';
import { PhaseTransitionError } from './phase.js';
import { createSecret, updateSecret } from './secrets.js';

export const FEISHU_APP_ID_SECRET = 'feishu.bot.app-id';
export const FEISHU_APP_SECRET_NAME = 'feishu.bot.app-secret';
export const FEISHU_EMPTY_REJECT_FEEDBACK = 'Rejected in Feishu';

const SECRET_NAMES = [FEISHU_APP_ID_SECRET, FEISHU_APP_SECRET_NAME] as const;

export interface FeishuBotDeps {
  db: Db;
  box: SecretBox;
}

export interface FeishuBotStatus {
  configured: boolean;
  appId: string | null;
  openId: string | null;
  cairnOrigin: string | null;
}

export interface FeishuCardAction {
  openId: string;
  action: 'approve' | 'reject';
  buildId: string;
  feedback?: string;
}

export type FeishuActionResult =
  | { accepted: true }
  | { accepted: false; reason: 'unbound' }
  | { accepted: false; reason: 'failed'; message: string };

export interface FeishuSender {
  sendCard(openId: string, card: unknown): Promise<void>;
}

export interface FeishuApprovalCardInput {
  prNumber: number;
  summary: string;
  cairnUrl: string;
  buildId: string;
}

let feishuSender: FeishuSender | null = null;

export function setFeishuSender(next: FeishuSender | null): void {
  feishuSender = next;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function namedSecret(deps: FeishuBotDeps, teamId: string, name: string) {
  return deps.db
    .select()
    .from(secret)
    .where(and(eq(secret.teamId, teamId), eq(secret.name, name)))
    .get();
}

function openNamed(deps: FeishuBotDeps, teamId: string, name: string): string | null {
  const row = namedSecret(deps, teamId, name);
  if (!row?.valueCipher) return null;
  try {
    return deps.box.open(row.valueCipher);
  } catch {
    return null;
  }
}

function writeNamed(deps: FeishuBotDeps, teamId: string, name: string, value: string): void {
  const row = namedSecret(deps, teamId, name);
  if (row) {
    updateSecret(deps, teamId, row.id, { value });
    return;
  }
  createSecret(deps, { teamId, name, value, description: null });
}

export function cairnOriginOf(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '') return null;
  if (url.pathname !== '/' && url.pathname !== '') return null;
  if (url.search !== '' || url.hash !== '') return null;
  return url.origin;
}

export function readFeishuBotStatus(deps: FeishuBotDeps, teamId: string): FeishuBotStatus {
  const binding = deps.db
    .select()
    .from(feishuBinding)
    .where(eq(feishuBinding.teamId, teamId))
    .get();
  const appId = openNamed(deps, teamId, FEISHU_APP_ID_SECRET);
  const appSecret = openNamed(deps, teamId, FEISHU_APP_SECRET_NAME);
  if (binding === undefined || appId === null || appSecret === null) {
    return { configured: false, appId: null, openId: null, cairnOrigin: null };
  }
  return { configured: true, appId, openId: binding.openId, cairnOrigin: binding.cairnOrigin };
}

export function readFeishuCredentials(
  deps: FeishuBotDeps,
  teamId: string,
): { appId: string; appSecret: string } | null {
  const status = readFeishuBotStatus(deps, teamId);
  if (!status.configured || status.appId === null) return null;
  const appSecret = openNamed(deps, teamId, FEISHU_APP_SECRET_NAME);
  if (appSecret === null) return null;
  return { appId: status.appId, appSecret };
}

export function saveFeishuBot(
  deps: FeishuBotDeps,
  input: {
    teamId: string;
    userId: string;
    appId: string;
    appSecret: string;
    openId: string;
    cairnOrigin: string;
  },
): void {
  const origin = cairnOriginOf(input.cairnOrigin);
  if (origin === null) throw new HttpError(400, 'invalid cairnOrigin');
  const appId = input.appId.trim();
  const openId = input.openId.trim();
  if (appId === '' || openId === '') throw new HttpError(400, 'invalid feishu bot');
  const appSecret = input.appSecret.trim();
  if (appSecret === '' && openNamed(deps, input.teamId, FEISHU_APP_SECRET_NAME) === null) {
    throw new HttpError(400, 'invalid appSecret');
  }
  writeNamed(deps, input.teamId, FEISHU_APP_ID_SECRET, appId);
  if (appSecret !== '') writeNamed(deps, input.teamId, FEISHU_APP_SECRET_NAME, appSecret);
  deps.db
    .insert(feishuBinding)
    .values({ teamId: input.teamId, userId: input.userId, openId, cairnOrigin: origin })
    .onConflictDoUpdate({
      target: feishuBinding.teamId,
      set: { userId: input.userId, openId, cairnOrigin: origin },
    })
    .run();
}

export function unbindFeishuBot(deps: FeishuBotDeps, teamId: string): void {
  deps.db.delete(feishuBinding).where(eq(feishuBinding.teamId, teamId)).run();
  for (const name of SECRET_NAMES) {
    const row = namedSecret(deps, teamId, name);
    if (row) deps.db.delete(secret).where(eq(secret.id, row.id)).run();
  }
}

export async function applyFeishuCardAction(
  deps: BuildDeps,
  input: FeishuCardAction,
): Promise<FeishuActionResult> {
  const binding = deps.db
    .select()
    .from(feishuBinding)
    .where(eq(feishuBinding.openId, input.openId))
    .get();
  const target = deps.db
    .select({ teamId: todo.teamId })
    .from(build)
    .innerJoin(todo, eq(todo.id, build.todoId))
    .where(eq(build.id, input.buildId))
    .get();
  const row =
    binding !== undefined && target?.teamId === binding.teamId
      ? deps.db.select().from(user).where(eq(user.id, binding.userId)).get()
      : undefined;
  if (row === undefined) return { accepted: false, reason: 'unbound' };
  const bound: UserRecord = { id: row.id, displayName: row.displayName, avatarUrl: row.avatarUrl };
  const acting: BuildDeps = { ...deps, user: bound };
  try {
    if (input.action === 'approve') {
      await requestMerge(acting, input.buildId, bound.displayName);
      return { accepted: true };
    }
    const note = (input.feedback ?? '').trim();
    const feedback = note === '' ? FEISHU_EMPTY_REJECT_FEEDBACK : note;
    await applyBuildStepAction(
      acting,
      input.buildId,
      {
        action: 'revision',
        side: 'plan',
        feedback,
        clientMessageId: newRecordId(),
      },
      bound.displayName,
    );
    return { accepted: true };
  } catch (err) {
    if (
      err instanceof HttpError ||
      err instanceof NotFoundError ||
      err instanceof PhaseTransitionError
    ) {
      return { accepted: false, reason: 'failed', message: err.message };
    }
    throw err;
  }
}

export function parseFeishuCardAction(payload: unknown): FeishuCardAction | null {
  const root = asRecord(payload);
  if (root === null) return null;
  const nested = asRecord(root.event);
  const event = nested !== null && asRecord(nested.operator) !== null ? nested : root;
  const operator = asRecord(event.operator);
  const action = asRecord(event.action);
  if (operator === null || action === null) return null;
  const openId = typeof operator.open_id === 'string' ? operator.open_id.trim() : '';
  if (openId === '') return null;
  const rawValue = action.value;
  let value: Record<string, unknown> | null = null;
  if (typeof rawValue === 'string') {
    try {
      value = asRecord(JSON.parse(rawValue) as unknown);
    } catch {
      value = null;
    }
  } else {
    value = asRecord(rawValue);
  }
  const fromValue = value !== null && typeof value.action === 'string' ? value.action : '';
  const fromName = typeof action.name === 'string' ? action.name : '';
  const kind = fromValue || fromName;
  if (kind !== 'approve' && kind !== 'reject') return null;
  const buildId = value !== null && typeof value.buildId === 'string' ? value.buildId : '';
  if (buildId === '') return null;
  const form = asRecord(action.form_value);
  const feedback = form !== null && typeof form.feedback === 'string' ? form.feedback : '';
  return { openId, action: kind, buildId, feedback };
}

function button(
  action: 'approve' | 'reject',
  label: string,
  tone: 'primary' | 'danger',
  buildId: string,
) {
  return {
    tag: 'button',
    text: { tag: 'plain_text', content: label },
    type: tone,
    name: action,
    form_action_type: 'submit',
    value: { action, buildId },
  };
}

export function feishuApprovalCard(input: FeishuApprovalCardInput): Record<string, unknown> {
  return {
    schema: '2.0',
    config: { update_multi: true },
    header: {
      title: { tag: 'plain_text', content: `PR #${input.prNumber} 要合并吗？` },
      template: 'blue',
    },
    body: {
      elements: [
        {
          tag: 'markdown',
          content: `${input.summary}\n\n[打开 Cairn](${input.cairnUrl})`,
        },
        {
          tag: 'form',
          name: 'approval',
          elements: [
            {
              tag: 'input',
              name: 'feedback',
              required: false,
              width: 'fill',
              placeholder: { tag: 'plain_text', content: '驳回理由（可选）' },
            },
            {
              tag: 'column_set',
              columns: [
                {
                  tag: 'column',
                  width: 'auto',
                  elements: [button('approve', '批准', 'primary', input.buildId)],
                },
                {
                  tag: 'column',
                  width: 'auto',
                  elements: [button('reject', '驳回', 'danger', input.buildId)],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

export function feishuChangeSummary(changes: unknown): string {
  const list = Array.isArray(changes)
    ? changes
    : asRecord(changes) !== null && Array.isArray(asRecord(changes)?.files)
      ? (asRecord(changes)?.files as unknown[])
      : [];
  const lines = list.flatMap((item) => {
    const file = asRecord(item);
    if (file === null || typeof file.path !== 'string') return [];
    const additions = typeof file.additions === 'number' ? file.additions : 0;
    const deletions = typeof file.deletions === 'number' ? file.deletions : 0;
    return [`${file.path} (+${additions} -${deletions})`];
  });
  if (lines.length === 0) return 'No file changes recorded.';
  const shown = lines.slice(0, 12);
  const extra = lines.length > 12 ? `\n+${lines.length - 12} more files` : '';
  return `${shown.join('\n')}${extra}`;
}

export async function deliverFeishuReviewCard(
  deps: { db: Db; box?: SecretBox },
  record: { id: string; teamId: string; title: string; seqNum: number },
): Promise<void> {
  if (feishuSender === null) return;
  const binding = deps.db
    .select()
    .from(feishuBinding)
    .where(eq(feishuBinding.teamId, record.teamId))
    .get();
  if (binding === undefined) return;
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, record.id)).get();
  const buildId = todoRow?.latestBuildId;
  if (buildId === null || buildId === undefined) return;
  const row = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  if (row === undefined || row.prNumber === null) return;
  await feishuSender.sendCard(
    binding.openId,
    feishuApprovalCard({
      prNumber: row.prNumber,
      summary: feishuChangeSummary(row.changes),
      cairnUrl: `${binding.cairnOrigin}/app/todo/${record.id}`,
      buildId: row.id,
    }),
  );
}

setFeishuReviewListener((deps, record) => {
  if (feishuSender === null) return;
  void deliverFeishuReviewCard(deps, record).catch(() => {
    process.stderr.write('feishu card delivery failed\n');
  });
});
