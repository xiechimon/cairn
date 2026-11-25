import type { KeyboardEvent } from 'react';
import { expect, test, vi } from 'vitest';
import { useComposerWire } from '../src/overlay/composer-wire.js';

vi.mock('react', () => ({
  useCallback: (callback: unknown) => callback,
  useEffect: () => {},
  useLayoutEffect: () => {},
  useId: () => 'test-id',
  useMemo: (factory: () => unknown) => factory(),
  useRef: (current: unknown) => ({ current }),
  useState: (value: unknown) => [value, vi.fn()],
}));
vi.mock('../src/i18n/provider.js', () => ({ useI18n: () => ({ t: (text: string) => text }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));

function keyboard(key: string, modifiers: Partial<KeyboardEvent<HTMLTextAreaElement>> = {}) {
  return { key, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, repeat: false, nativeEvent: { isComposing: false }, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...modifiers } as unknown as KeyboardEvent<HTMLTextAreaElement>;
}

function composer(withEscapeStop = false) {
  const onSend = vi.fn();
  const onQueue = vi.fn();
  const onStop = vi.fn();
  const onDraftChange = vi.fn();
  const wire = useComposerWire({
    editable: true,
    draft: 'Next message',
    onDraftChange,
    onSend,
    onQueue,
    ...(withEscapeStop ? { stop: { available: true, onStop } } : {}),
  });
  return { ...wire, onSend, onQueue, onStop, onDraftChange };
}

test.each(['metaKey', 'ctrlKey'])('%s Enter queues without steering', async (modifier) => {
  const wire = composer();
  wire.handleKeyDown(keyboard('Enter', { [modifier]: true }));
  await Promise.resolve();
  expect(wire.onQueue).toHaveBeenCalledExactlyOnceWith('Next message');
  expect(wire.onSend).not.toHaveBeenCalled();
  expect(wire.onDraftChange).toHaveBeenCalledWith('');
});

test('plain Enter steers and Shift Enter retains the draft', () => {
  const wire = composer();
  wire.handleKeyDown(keyboard('Enter', { shiftKey: true }));
  expect(wire.onSend).not.toHaveBeenCalled();
  wire.handleKeyDown(keyboard('Enter'));
  expect(wire.onSend).toHaveBeenCalledExactlyOnceWith('Next message');
});

test('single and double Escape never silently stop a task or submit an unfinished draft', () => {
  const wire = composer(false);
  const first = keyboard('Escape');
  wire.handleKeyDown(first);
  wire.handleKeyDown(keyboard('Escape'));
  expect(wire.onStop).not.toHaveBeenCalled();
  expect(wire.onQueue).not.toHaveBeenCalled();
  expect(wire.onSend).not.toHaveBeenCalled();
  expect(wire.onDraftChange).not.toHaveBeenCalled();
  expect(first.preventDefault).not.toHaveBeenCalled();

  const coordinatorWire = composer(true);
  coordinatorWire.handleKeyDown(keyboard('Escape'));
  coordinatorWire.handleKeyDown(keyboard('Escape'));
  expect(coordinatorWire.onQueue).not.toHaveBeenCalled();
  expect(coordinatorWire.onSend).not.toHaveBeenCalled();
  expect(coordinatorWire.onDraftChange).not.toHaveBeenCalled();
});

test('IME composition and repeated Escape never stop or send', () => {
  const wire = composer(true);
  wire.handleKeyDown(keyboard('Escape', { nativeEvent: { isComposing: true } as KeyboardEvent<HTMLTextAreaElement>['nativeEvent'] }));
  wire.handleKeyDown(keyboard('Escape', { repeat: true }));
  expect(wire.onStop).not.toHaveBeenCalled();
  expect(wire.onQueue).not.toHaveBeenCalled();
});

test('a pending queue request cannot submit the same draft twice', async () => {
  const wire = composer();
  let complete = () => {};
  wire.onQueue.mockReturnValue(new Promise<void>((resolve) => { complete = resolve; }));
  wire.handleKeyDown(keyboard('Enter', { ctrlKey: true }));
  wire.handleKeyDown(keyboard('Enter', { ctrlKey: true }));
  expect(wire.onQueue).toHaveBeenCalledOnce();
  expect(wire.onDraftChange).not.toHaveBeenCalled();
  complete();
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(wire.onDraftChange).toHaveBeenCalledExactlyOnceWith('');
});

test('a rejected queue request retains the draft and permits retry', async () => {
  const wire = composer();
  wire.onQueue.mockRejectedValueOnce(new Error('Network unavailable'));
  wire.handleKeyDown(keyboard('Enter', { ctrlKey: true }));
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(wire.onDraftChange).not.toHaveBeenCalled();
  wire.handleKeyDown(keyboard('Enter', { ctrlKey: true }));
  expect(wire.onQueue).toHaveBeenCalledTimes(2);
  expect(wire.onDraftChange).toHaveBeenCalledExactlyOnceWith('');
});
