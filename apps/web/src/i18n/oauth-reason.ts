import type { TFunc } from './translate.js';

export function oauthReasonCopy(reason: string | null, t: TFunc): string {
  return reason === 'denied'
    ? t('授权已被取消。')
    : reason === 'state'
      ? t('连接已过期，请重新发起。')
      : t('令牌交换失败，请稍后重试。');
}
