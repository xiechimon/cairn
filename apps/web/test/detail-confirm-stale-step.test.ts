import { expect, test, vi } from 'vitest';
import { type DetailComposerInput, useDetailComposer } from '../src/detail/use-detail-composer.js';

vi.mock('../src/i18n/provider.js', () => ({ useI18n: () => ({ t: (text: string) => text }) }));
vi.mock('../src/components/ui/toaster.js', () => ({ toastError: vi.fn() }));

test('confirmation feedback requests a revision when the steps query still reports a running step', () => {
  const mutate = vi.fn();
  const mutateAsync = vi.fn().mockResolvedValue(undefined);
  const input: DetailComposerInput = {
    live: true,
    phase: 'confirm',
    buildId: 'confirmed-build',
    running: true,
    mutations: {
      stepAction: { mutate },
      sendSteer: { mutateAsync },
    } as unknown as DetailComposerInput['mutations'],
    scrollToEnd: vi.fn(),
    clearDraft: vi.fn(),
    chain: 'idle',
    setChain: vi.fn(),
    revisionAvailable: false,
  };
  useDetailComposer(input).onSend?.('Drop the project suffix from the title');
  expect(mutate).toHaveBeenCalledExactlyOnceWith({
    buildId: 'confirmed-build',
    body: {
      action: 'revision',
      side: 'plan',
      feedback: 'Drop the project suffix from the title',
      clientMessageId: expect.any(String),
    },
  });
  expect(mutateAsync).not.toHaveBeenCalled();
});
