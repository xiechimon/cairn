import { QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { beforeEach, expect, test, vi } from 'vitest';
import { createProductQueryClient } from '../src/api/provider.js';
import { toastError } from '../src/components/ui/toaster.js';
import { setActiveLocale } from '../src/i18n/locale.js';

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

setActiveLocale('zh');

beforeEach(() => {
  vi.clearAllMocks();
});

test('the production QueryClient reports an unhandled mutation error as a toast', async () => {
  const client = createProductQueryClient();
  expect(client.getDefaultOptions().mutations?.onError).toBeTypeOf('function');
  client.getDefaultOptions().mutations?.onError?.(new TypeError('Failed to fetch'), undefined, undefined, undefined as never);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(toast.error).toHaveBeenCalledWith('操作失败，请重试。', {
    description: '网络连接异常，请检查网络后重试。',
  });
});

test('a mutation error already surfaced locally does not duplicate the fallback toast', async () => {
  const client = createProductQueryClient();
  const error = Object.assign(new TypeError('Failed to fetch'), { reason: 'duplicate-check' });
  client.getDefaultOptions().mutations?.onError?.(error, undefined, undefined, undefined as never);
  toastError('发送失败，请重试。', error);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(toast.error).toHaveBeenCalledTimes(1);
  expect(toast.error).toHaveBeenCalledWith('发送失败，请重试。', {
    description: '网络连接异常，请检查网络后重试。',
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
