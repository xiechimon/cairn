import type { RetryReasonCode, TodoRetryState } from '@cairn/shared';
import type { TodoRecord } from '../fixtures/records.js';
import { dateTimeFormat } from '../lib/date-format.js';

export interface RetryPhrase {
  key: string;
  params?: Record<string, string | number>;
}

export function formatRetryClock(ms: number): string {
  return dateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(ms);
}

export function quotaResumePhrase(kind: 'quota' | 'capacity', retryAt: number | null): RetryPhrase {
  if (retryAt === null) {
    return kind === 'quota' ? { key: '额度恢复后自动继续' } : { key: '限流恢复后自动继续' };
  }
  const time = formatRetryClock(retryAt);
  return kind === 'quota'
    ? { key: '额度 {time} 恢复后自动继续', params: { time } }
    : { key: '限流 {time} 恢复后自动继续', params: { time } };
}

export function isWaitingToRetry(todo: Pick<TodoRecord, 'phase' | 'retry'>): boolean {
  return todo.phase === 'failed' && todo.retry?.state === 'scheduled';
}

export function scheduledRetryPhrase(
  retry: Extract<TodoRetryState, { state: 'scheduled' }>,
): RetryPhrase {
  if (retry.failureClass === 'rate_limit') {
    return quotaResumePhrase(
      retry.reasonCode === 'quota' ? 'quota' : 'capacity',
      retry.nextRetryAt,
    );
  }
  return {
    key: '{time} 自动重试（第 {attempt} 次）',
    params: { time: formatRetryClock(retry.nextRetryAt), attempt: retry.attempt },
  };
}

export function scheduledFailureHeadline(reasonCode: RetryReasonCode): RetryPhrase {
  switch (reasonCode) {
    case 'network':
      return { key: '网络中断' };
    case 'server_error':
      return { key: '服务商暂时异常' };
    case 'runner_disconnect':
      return { key: '执行机连接中断' };
    case 'quota':
      return { key: '额度已用尽' };
    case 'rate_limit':
      return { key: '已触发限流' };
    default:
      return { key: '本步异常结束' };
  }
}

export function parkedRetryCopy(retry: Extract<TodoRetryState, { state: 'parked' }>): {
  title: RetryPhrase;
  fix: RetryPhrase;
} {
  switch (retry.reasonCode) {
    case 'setup_hook':
      return {
        title: { key: '环境初始化失败，已停止自动重试' },
        fix: { key: '请修复项目的环境初始化脚本后重试。' },
      };
    case 'missing_tool':
      return {
        title: { key: '缺少所需工具，已停止自动重试' },
        fix: { key: '请在执行机安装缺少的工具后重试。' },
      };
    case 'auth':
      return {
        title: { key: '凭据或登录失效，已停止自动重试' },
        fix: { key: '请检查凭据或重新连接服务商后重试。' },
      };
    case 'spend_limit':
      return {
        title: { key: '已达到费用上限，已停止自动重试' },
        fix: { key: '请调整服务商预算上限或更换服务商后重试。' },
      };
    case 'config':
      return {
        title: { key: '配置或请求参数有误，已停止自动重试' },
        fix: { key: '请检查任务或服务商配置后重试。' },
      };
    case 'model_unavailable':
      return {
        title:
          retry.detail !== null && retry.detail !== ''
            ? { key: '模型 {model} 不可用，已停止自动重试', params: { model: retry.detail } }
            : { key: '所选模型不可用，已停止自动重试' },
        fix: { key: '请在模型路由中更换可用模型后重试。' },
      };
    case 'runtime_outdated':
      return {
        title:
          retry.detail !== null && retry.detail !== ''
            ? {
                key: '内置运行环境版本过旧（需 {need}），已停止自动重试',
                params: { need: retry.detail },
              }
            : { key: '内置运行环境版本过旧，已停止自动重试' },
        fix: { key: '更新 Cairn 后重新运行这个任务。' },
      };
    case 'gate_rejection':
      return {
        title: { key: '未通过验收检查，已停止自动重试' },
        fix: { key: '请查看检查说明并处理后再重试。' },
      };
    case 'branch_divergence':
      return {
        title: { key: '远端分支存在冲突改动，已停止自动重试' },
        fix: { key: '请先处理远端分支冲突后再重试。' },
      };
    case 'window_exhausted':
      return {
        title: { key: '连续重试 6 小时未恢复，已停止自动重试' },
        fix: { key: '服务商或网络持续异常，确认恢复后可点击立即重试。' },
      };
    case 'rate_limit_exhausted':
      return {
        title: { key: '限流等待已超过 24 小时，已停止自动重试' },
        fix: { key: '请确认额度或限流状态后点击立即重试。' },
      };
    case 'retries_exhausted':
      return {
        title:
          retry.attemptsMade > 0
            ? { key: '自动重试 {n} 次未恢复，已停止自动重试', params: { n: retry.attemptsMade } }
            : { key: '已停止自动重试' },
        fix: { key: '请查看原始错误并处理后点击立即重试。' },
      };
    case 'breaker':
      return {
        title: { key: '一小时内连续失败过多，已停止自动重试' },
        fix: { key: '请查看原始错误并排查原因后点击立即重试。' },
      };
    default:
      return {
        title: { key: '已停止自动重试' },
        fix: { key: '请查看原始错误后点击立即重试，或在下方回复说明修改方式。' },
      };
  }
}

export function todoRetryPhrase(todo: TodoRecord): RetryPhrase | null {
  if (todo.quotaWait != null) {
    return quotaResumePhrase(todo.quotaWait.kind, todo.quotaWait.probeAt);
  }
  if (todo.waitingOn?.on === 'quota') {
    return quotaResumePhrase('quota', todo.waitingOn.retryAt);
  }
  if (todo.phase !== 'failed' || todo.retry == null) return null;
  return todo.retry.state === 'scheduled'
    ? scheduledRetryPhrase(todo.retry)
    : parkedRetryCopy(todo.retry).title;
}

export function canRetryNow(todo: TodoRecord): boolean {
  if (todo.archivedAt != null) return false;
  return todo.phase === 'failed' || todo.quotaWait != null || todo.waitingOn?.on === 'quota';
}
