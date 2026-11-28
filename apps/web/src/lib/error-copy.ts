import {
  CHIEF_MESSAGE_MERGED,
  CHIEF_MESSAGE_READ,
  COORDINATOR_NOT_READY,
  MEMORY_EDIT_MOVED,
  QUEUED_MESSAGE_CANCELLED,
  TASK_ARCHIVED,
  TASK_CLOSED,
  TASK_COMPUTER_OFFLINE,
} from '@cairn/shared';
import { ApiError } from '../api/client.js';
import { EN } from '../i18n/en.js';
import { activeLocale } from '../i18n/locale.js';
import { type TFunc, translate } from '../i18n/translate.js';
import { safeLocalStorage } from '../safe-storage.js';
import {
  SendCancelledError,
  SendStaleError,
  SendTimeoutError,
  ServerUnreachableError,
} from './send-errors.js';

const REMOVED_FROM_QUEUE_COPY = '这条消息已从队列删除，没有再次发送。';

const REASON_COPY: Record<string, string> = {
  [QUEUED_MESSAGE_CANCELLED]: REMOVED_FROM_QUEUE_COPY,
  [TASK_ARCHIVED]: '这个任务已归档。取消归档后才能继续。',
  [TASK_CLOSED]: '这个任务已关闭，消息没有发出。',
  'already-started': '这个任务已经开始过，无法退回待开始。',
  'build-not-delivered': '本轮运行尚未产生交付结果，请重新运行后再合并。',
  'missing-delivery-artifact': '本轮运行没有产生分支或 PR，请重新运行后再合并。',
  duplicate: '存在同名记录，请更换名称后重试。',
  offline: '当前未连接到服务，请稍后重试。',
  unauthorized: '登录状态已失效，请重新登录后重试。',
  forbidden: '没有操作权限，请联系团队管理员。',
  not_found: '目标已不存在，请刷新后重试。',
  conflict: '当前状态已变化，请刷新后重试。',
  rate_limited: '请求过于频繁，请稍后重试。',
  [COORDINATOR_NOT_READY]: 'Coordinator 暂无可用模型，请先在设置里配置模型来源。',
  timeout: '请求超时，请检查网络后重试。',
  [CHIEF_MESSAGE_READ]: 'Coordinator 已经读到这条了。',
  [CHIEF_MESSAGE_MERGED]: '这条已经和其他消息合在一起了，不能单独撤回。',
  [MEMORY_EDIT_MOVED]: '这次记忆修改已经重新开始，请看最新的一次。',
  [TASK_COMPUTER_OFFLINE]: '运行这个任务的电脑当前未连接，等它上线后再停止。',
};

const NETWORK_ERROR_RE = /failed to fetch|network|load failed/i;
const STACK_FRAME_RE = /\bat\s+\S+\s*\(/;
const HTML_BODY_RE = /<(?:!doctype|html|head|body)\b/i;
const RAW_NOISE_RE =
  /\b(?:sqlite|syntaxerror|typeerror|referenceerror|econnrefused|enotfound|etimedout|invalid body|unexpected token)\b/i;
const GENERIC_HTTP_PHRASES = new Set([
  'bad request',
  'unauthorized',
  'forbidden',
  'not found',
  'conflict',
  'too many requests',
  'internal server error',
  'bad gateway',
  'service unavailable',
  'gateway timeout',
  'request failed',
]);
const STATUS_ONLY_RE = /^http\s*\d+(?:\s*[:-]\s*(?:\S.*)?)?$/i;
const MASKED_GATEWAY_STATUSES = new Set([408, 429, 502, 503, 504]);

function isSafeServerMessage(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed === '' || trimmed.length > 200 || trimmed.includes('\n')) return false;
  if (STACK_FRAME_RE.test(trimmed) || HTML_BODY_RE.test(trimmed) || RAW_NOISE_RE.test(trimmed))
    return false;
  const lower = trimmed.toLowerCase();
  if (GENERIC_HTTP_PHRASES.has(lower) || STATUS_ONLY_RE.test(lower)) return false;
  return true;
}

function isNetworkFailure(error: unknown): boolean {
  return error instanceof Error && NETWORK_ERROR_RE.test(error.message);
}

const UNREACHABLE_GATEWAY_STATUSES = new Set([502, 503, 504]);

export function isServerUnreachable(error: unknown): boolean {
  if (error instanceof ServerUnreachableError) return true;
  if (error instanceof ApiError) return UNREACHABLE_GATEWAY_STATUSES.has(error.status);
  return isNetworkFailure(error);
}

export function describeError(
  error: unknown,
  t: TFunc,
  options: { serverText?: boolean } = {},
): string | null {
  if (error == null) return null;
  if (error instanceof SendTimeoutError) return t('不确定是否送达，重发前请先看对话里有没有这条。');
  if (error instanceof ServerUnreachableError) return t('网络连接异常，请检查网络后重试。');
  if (error instanceof SendStaleError) return t('超过 10 分钟未确认送达，已停止自动重发。');
  if (error instanceof SendCancelledError) return t(REMOVED_FROM_QUEUE_COPY);
  if (error instanceof ApiError) {
    const byReason = error.reason !== undefined ? REASON_COPY[error.reason] : undefined;
    if (byReason !== undefined) return t(byReason);
    if (
      options.serverText !== false &&
      !error.hideServerText &&
      !MASKED_GATEWAY_STATUSES.has(error.status) &&
      isSafeServerMessage(error.message)
    ) {
      return error.message.trim();
    }
    if (error.status === 401 || error.status === 403) {
      return t('没有操作权限，请重新登录后重试。');
    }
    if (error.status === 404) {
      return t('目标已不存在，请刷新后重试。');
    }
    if (error.status === 408 || error.status === 504) {
      return t('请求超时，请检查网络后重试。');
    }
    if (error.status === 409) {
      return t('当前状态已变化，请刷新后重试。');
    }
    if (error.status === 429) {
      return t('请求过于频繁，请稍后重试。');
    }
    if (error.status >= 500) {
      return t('服务暂时异常，请稍后重试。');
    }
    return t('请求未通过，请检查填写内容后重试。');
  }
  if (isNetworkFailure(error)) {
    return t('网络连接异常，请检查网络后重试。');
  }
  return null;
}

export function describeErrorForToast(error: unknown): string | null {
  const locale = activeLocale(safeLocalStorage());
  return describeError(error, (source, vars) => translate(locale, EN, source, vars), {
    serverText: false,
  });
}
