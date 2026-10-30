import { expect, test, vi } from 'vitest';
import { type DetailComposerInput, useDetailComposer } from '../src/detail/use-detail-composer.js';
import { PHASE_UI } from '../src/phase.js';
import { EN } from '../src/i18n/en.js';
import { ApiError } from '../src/api/client.js';
import { toastError } from '../src/components/ui/toaster.js';

vi.mock('../src/i18n/provider.js', () => ({ useI18n: () => ({ t: (text: string) => text }) }));
vi.mock('../src/components/ui/toaster.js', () => ({ toastError: vi.fn() }));

test('the done placeholder describes continuing the task in both languages', () => {
  expect(PHASE_UI.done.placeholder).toBe('发送消息以继续这个任务…');
  expect(EN[PHASE_UI.done.placeholder!]).toBe('Send a message to continue this task…');
});

test('a done task exposes a composer and sends its follow-up to the existing conversation', async () => {
  const mutateAsync = vi.fn().mockResolvedValue({ message: { id: 'follow-up' } });
  const clearDraft = vi.fn();
  const scrollToEnd = vi.fn();
  const input: DetailComposerInput = {
    live: true,
    phase: 'done',
    buildId: 'completed-build',
    running: false,
    mutations: { sendSteer: { mutateAsync } } as unknown as DetailComposerInput['mutations'],
    scrollToEnd,
    clearDraft,
    chain: 'idle',
    setChain: vi.fn(),
    revisionAvailable: false,
  };
  expect(PHASE_UI.done.placeholder).toBeTruthy();
  await useDetailComposer(input).onSend?.('Continue the task');
  expect(mutateAsync).toHaveBeenCalledExactlyOnceWith({
    conversationId: 'completed-build',
    content: 'Continue the task',
  });
  expect(clearDraft).toHaveBeenCalledOnce();
  expect(scrollToEnd).toHaveBeenCalledOnce();
});

test('a rejected continuation keeps the draft available for retry', async () => {
  const error = new ApiError(409, 'PR #43 is already merged. Create a new task.');
  const mutateAsync = vi.fn().mockRejectedValue(error);
  const clearDraft = vi.fn();
  const input: DetailComposerInput = {
    live: true,
    phase: 'done',
    buildId: 'completed-build',
    running: false,
    mutations: { sendSteer: { mutateAsync } } as unknown as DetailComposerInput['mutations'],
    scrollToEnd: vi.fn(),
    clearDraft,
    chain: 'idle',
    setChain: vi.fn(),
    revisionAvailable: false,
  };
  await expect(useDetailComposer(input).onSend?.('Continue the task')).rejects.toThrow(error);
  expect(clearDraft).not.toHaveBeenCalled();
  expect(toastError).toHaveBeenCalledWith('发送失败，请重试。', error);
});
