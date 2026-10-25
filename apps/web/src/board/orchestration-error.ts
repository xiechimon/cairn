const httpStatus = (codes: string) =>
  new RegExp(`(?:^|\\b(?:status|code|error|http)\\W{0,3})(?:${codes})\\b`, 'i');

const SUMMARIES: ReadonlyArray<readonly [RegExp, string]> = [
  [
    /context[_ ]length|maximum context|too many tokens|prompt is too long/i,
    '上下文超出模型上限，精简任务后重试',
  ],
  [/rate[_ ]?limit|insufficient_quota|quota exceeded/i, '额度不足或请求太频繁，稍后重试'],
  [httpStatus('429'), '额度不足或请求太频繁，稍后重试'],
  [
    /unauthori[sz]ed|forbidden|invalid[-_ ]x?-?api[-_ ]key|authentication/i,
    '模型服务鉴权失败，检查密钥',
  ],
  [httpStatus('401|403'), '模型服务鉴权失败，检查密钥'],
  [
    /disconnect|connection reset|econnreset|socket hang up|stream (closed|ended)|network/i,
    '连接中断，可以重试',
  ],
  [/timed? ?out|etimedout|deadline/i, '请求超时，可以重试'],
  [/overloaded|server error|bad gateway|service unavailable/i, '模型服务暂时不可用，可以重试'],
  [httpStatus('5\\d\\d'), '模型服务暂时不可用，可以重试'],
];

export function orchestrationErrorSummary(raw: string): string {
  return SUMMARIES.find(([pattern]) => pattern.test(raw))?.[1] ?? '出了点问题，可以重试或查看会话';
}
