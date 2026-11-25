import { QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { expect, test, vi } from 'vitest';
import { createProductQueryClient } from '../src/api/provider.js';
import { setActiveLocale } from '../src/i18n/locale.js';

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

setActiveLocale('zh');

test('the production QueryClient reports an unhandled mutation error as a toast', async () => {
  const client = createProductQueryClient();
  expect(client.getDefaultOptions().mutations?.onError).toBeTypeOf('function');
  client.getDefaultOptions().mutations?.onError?.(new TypeError('Failed to fetch'), undefined, undefined, undefined as never);
  expect(toast.error).toHaveBeenCalledWith('操作失败，请重试。', {
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
