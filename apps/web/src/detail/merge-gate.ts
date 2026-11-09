import type { MergeReadiness } from '@cairn/shared';
import { ApiError } from '../api/client.js';
import type { TFunc } from '../i18n/translate.js';

export function mergeRejectCopy(error: unknown, t: TFunc, fallback?: string): string {
  return error instanceof ApiError && error.status < 500 && error.message !== ''
    ? error.message
    : (fallback ?? t('合并请求未送出，请重试。'));
}

export function mergePreselected(input: { hasPr: boolean; gate: MergeReadiness | null }): boolean {
  if (!input.hasPr) return true;
  return input.gate?.blockers.every((b) => b.code === 'policy-human') ?? false;
}
