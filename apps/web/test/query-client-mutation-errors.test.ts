import { QueryClient } from '@tanstack/react-query';
import { toast as sonnerToast } from 'sonner';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '../src/api/client.js';
import { createProductQueryClient } from '../src/api/provider.js';
import { toast, toastError } from '../src/components/ui/toaster.js';
import { setActiveLocale } from '../src/i18n/locale.js';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

setActiveLocale('zh');

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  setActiveLocale('zh');
});

function failMutation(error: Error, action?: string) {
  const client = createProductQueryClient();
  client
    .getDefaultOptions()
    .mutations?.onError?.(error, undefined, undefined, {
      client,
      meta: action === undefined ? undefined : { action },
      mutationKey: undefined,
    });
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function shownToasts() {
  return vi.mocked(sonnerToast.error).mock.calls.map(([title, data]) => ({
    title,
    description: data?.description,
    id: data?.id,
  }));
}

test('the production QueryClient reports an unhandled mutation error as a toast', async () => {
  const client = createProductQueryClient();
  expect(client.getDefaultOptions().mutations?.onError).toBeTypeOf('function');
  await failMutation(new TypeError('Failed to fetch'));
  expect(shownToasts()).toEqual([
    {
      title: '操作失败，请重试。',
      description: '网络连接异常，请检查网络后重试。',
      id: expect.any(String),
    },
  ]);
});

test('an unhandled mutation failure is titled by the action that failed', async () => {
  await failMutation(new TypeError('Failed to fetch'), '添加服务商');
  expect(shownToasts()[0]?.title).toBe('添加服务商失败');
  expect(shownToasts()[0]?.description).toBe('网络连接异常，请检查网络后重试。');
  setActiveLocale('en');
  await failMutation(new TypeError('Failed to fetch'), '添加服务商');
  expect(shownToasts()[1]?.title).toBe('Add provider failed');
  expect(shownToasts()[1]?.description).toBe('Network error. Check your connection and try again.');
});

test('server prose never becomes the toast body', async () => {
  await failMutation(new ApiError(404, 'Codex device login not found'), '登录 ChatGPT 订阅');
  await failMutation(new ApiError(500, 'upstream refused'), '添加服务商');
  expect(shownToasts().map(({ title, description }) => [title, description])).toEqual([
    ['登录 ChatGPT 订阅失败', '目标已不存在，请刷新后重试。'],
    ['添加服务商失败', '服务暂时异常，请稍后重试。'],
  ]);
});

test('the same failure twice updates one toast instead of stacking two', async () => {
  await failMutation(new ApiError(500, 'boom'), '添加服务商');
  await failMutation(new ApiError(500, 'boom'), '添加服务商');
  const [first, second] = shownToasts();
  expect(first?.id).toBeTypeOf('string');
  expect(second?.id).toBe(first?.id);
  toast('已复制');
  toast('已复制');
  const plain = vi.mocked(sonnerToast).mock.calls;
  expect(plain[1]?.[1]?.id).toBe(plain[0]?.[1]?.id);
  toast.error('添加服务商失败', { description: '另一条原因' });
  expect(vi.mocked(sonnerToast.error).mock.calls[2]?.[1]?.id).not.toBe(first?.id);
});

test('toasts that carry an action or an explicit id are never merged', () => {
  const undo = { label: '撤销', onClick: () => {} };
  toast('任务已删除', { action: undo });
  toast('任务已删除', { action: undo });
  for (const [, data] of vi.mocked(sonnerToast).mock.calls) expect(data?.id).toBeUndefined();
  toast.error('有一条消息尚未确认发出', { id: 'unsent-1' });
  expect(vi.mocked(sonnerToast.error).mock.calls[0]?.[1]?.id).toBe('unsent-1');
});

test('a mutation error already surfaced locally does not duplicate the fallback toast', async () => {
  const client = createProductQueryClient();
  const error = Object.assign(new TypeError('Failed to fetch'), { reason: 'duplicate-check' });
  client.getDefaultOptions().mutations?.onError?.(error, undefined, undefined, undefined as never);
  toastError('发送失败，请重试。', error);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(sonnerToast.error).toHaveBeenCalledTimes(1);
  expect(shownToasts()[0]).toEqual({
    title: '发送失败，请重试。',
    description: '网络连接异常，请检查网络后重试。',
    id: expect.any(String),
  });
});

test('a mutation hook handler overrides the product default instead of duplicating it', () => {
  const client = createProductQueryClient();
  const local = vi.fn();
  const options = client.defaultMutationOptions({ onError: local });
  expect(options.onError).toBe(local);
});

test('plain test QueryClients stay quiet and unchanged', () => {
  expect(new QueryClient().getDefaultOptions().mutations?.onError).toBeUndefined();
});
