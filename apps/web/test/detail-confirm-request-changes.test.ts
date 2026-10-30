import { expect, test, vi } from 'vitest';
import { type DetailComposerInput, useDetailComposer } from '../src/detail/use-detail-composer.js';

vi.mock('../src/i18n/provider.js', () => ({ useI18n: () => ({ t: (text: string) => text }) }));
vi.mock('../src/components/ui/toaster.js', () => ({ toastError: vi.fn(), toastSuccess: vi.fn() }));

test.each([false, true])(
  'a message at the confirm gate requests plan changes even when a step is pending (running=%s)',
  async (running) => {
    const mutate = vi.fn();
    const mutateAsync = vi.fn();
    const input: DetailComposerInput = {
      live: true,
      phase: 'confirm',
      buildId: 'plan-build',
      running,
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
    await useDetailComposer(input).onSend?.('Drop the project suffix from the title');
    expect(mutate).toHaveBeenCalledOnce();
    expect(mutate.mock.calls[0]?.[0]).toMatchObject({ buildId: 'plan-build' });
    expect(mutateAsync).not.toHaveBeenCalled();
  },
);
