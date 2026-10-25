import { expect, test } from 'vitest';
import { orchestrationErrorSummary } from '../src/board/orchestration-error.js';

test.each([
  ['API Error: upstream stream disconnected: connection reset by peer', '连接中断，可以重试'],
  ['socket hang up', '连接中断，可以重试'],
  ['400 context_length_exceeded: maximum context length is 200000 tokens', '上下文超出模型上限，精简任务后重试'],
  ['request timed out after 600000ms', '请求超时，可以重试'],
  ['429 rate_limit_error: too many requests', '额度不足或请求太频繁，稍后重试'],
  ['insufficient_quota', '额度不足或请求太频繁，稍后重试'],
  ['401 invalid x-api-key', '模型服务鉴权失败，检查密钥'],
  ['529 overloaded_error', '模型服务暂时不可用，可以重试'],
  ['something odd happened', '出了点问题，可以重试或查看会话'],
  ['insufficient permissions to read repo', '出了点问题，可以重试或查看会话'],
  ['tool failed: wrote 512 lines then exited', '出了点问题，可以重试或查看会话'],
  ['retry after 401 seconds', '出了点问题，可以重试或查看会话'],
  ['API Error: 503 Service Unavailable', '模型服务暂时不可用，可以重试'],
  ['status 429', '额度不足或请求太频繁，稍后重试'],
])('%s reads as %s', (raw, summary) => {
  expect(orchestrationErrorSummary(raw)).toBe(summary);
});
