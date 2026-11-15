// OAuth callback 着陆 reason 文案（#243 三路分译单源；#361 复用同词汇）：
// denied = 用户在 provider 站取消 / state = state 缺或过期 / 其余值 =
// exchange 兜底（含未知 reason，与 #231 原 else 行为同）。providers 页
// （#231 provider 族）与新建项目页（#361 github-connection 族）两着陆面
// 共用——server 侧 reason 词汇（services/oauth.ts OAuthFlowError）扩族时
// 只改此处。

import type { TFunc } from './translate.js';

export function oauthReasonCopy(reason: string | null, t: TFunc): string {
  return reason === 'denied'
    ? t('授权已被取消。')
    : reason === 'state'
      ? t('连接已过期，请重新发起。')
      : t('令牌交换失败，请稍后重试。');
}
