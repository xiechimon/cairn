import type { KeyboardEvent } from 'react';
import { expect, test, vi } from 'vitest';
import { withoutReturnedText } from '../src/chief/outbox.js';
import { useComposerWire } from '../src/overlay/composer-wire.js';
import { DraftSync } from '../src/overlay/draft-sync.js';

const hooks = vi.hoisted(() => ({
  active: false,
  slots: [] as unknown[],
  cursor: 0,
  run<T>(fn: () => T): T {
    this.active = true;
    this.cursor = 0;
    try {
      return fn();
    } finally {
      this.active = false;
    }
  },
  reset() {
    this.slots = [];
    this.cursor = 0;
    this.active = false;
  },
}));

vi.mock('react', () => ({
  useCallback: (callback: unknown) => callback,
  useEffect: () => {},
  useLayoutEffect: () => {},
  useId: () => 'test-id',
  useMemo: (factory: () => unknown) => factory(),
  useRef: (initial: unknown) => {
    if (!hooks.active) return { current: initial };
    const idx = hooks.cursor++;
    if (!(idx in hooks.slots)) hooks.slots[idx] = { current: initial };
    return hooks.slots[idx];
  },
  useState: (initial: unknown) => {
    if (!hooks.active) return [initial, vi.fn()];
    const idx = hooks.cursor++;
    if (!(idx in hooks.slots)) {
      hooks.slots[idx] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    }
    const set = (next: unknown) => {
      hooks.slots[idx] =
        typeof next === 'function'
          ? (next as (prev: unknown) => unknown)(hooks.slots[idx])
          : next;
    };
    return [hooks.slots[idx], set];
  },
}));
vi.mock('../src/i18n/provider.js', () => ({ useI18n: () => ({ t: (text: string) => text }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function keyboard(key: string, modifiers: Partial<KeyboardEvent<HTMLTextAreaElement>> = {}) {
  return { key, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, repeat: false, nativeEvent: { isComposing: false }, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...modifiers } as unknown as KeyboardEvent<HTMLTextAreaElement>;
}

function composer() {
  const onSend = vi.fn();
  const onQueue = vi.fn();
  const onStop = vi.fn();
  const onDraftChange = vi.fn();
  const wire = useComposerWire({ editable: true, draft: 'Next message', onDraftChange, onSend, onQueue, onStopAndSend: onQueue, stop: { available: true, onStop } });
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

test('Escape stops without clearing; a second Escape sends the draft without a second stop', () => {
  const wire = composer();
  const first = keyboard('Escape');
  wire.handleKeyDown(first);
  expect(wire.onStop).toHaveBeenCalledOnce();
  expect(wire.onDraftChange).not.toHaveBeenCalled();
  expect(first.preventDefault).toHaveBeenCalled();
  expect(first.stopPropagation).toHaveBeenCalled();
  wire.handleKeyDown(keyboard('Escape'));
  expect(wire.onQueue).toHaveBeenCalledExactlyOnceWith('Next message');
  expect(wire.onDraftChange).toHaveBeenCalledWith('');
  expect(wire.onStop).toHaveBeenCalledOnce();
});

test('IME composition and repeated Escape never stop or send', () => {
  const wire = composer();
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

test('Enter during an attachment upload sends the message with the attachment once the upload lands', async () => {
  let finish: (tokens: string[]) => void = () => {};
  const onSend = vi.fn();
  const onDraftChange = vi.fn();
  const wire = useComposerWire({
    editable: true,
    draft: '你是什么 llm',
    onDraftChange,
    onSend,
    onAttachment: () => new Promise<string[]>((resolve) => {
      finish = resolve;
    }),
  });
  wire.attachFiles([new File(['x'], 'shot.png', { type: 'image/png' })]);
  wire.handleKeyDown(keyboard('Enter'));
  await Promise.resolve();
  expect(onSend).not.toHaveBeenCalled();
  finish(['[shot.png](attachment://a1)']);
  await vi.waitFor(() => expect(onSend).toHaveBeenCalledOnce());
  expect(onSend.mock.calls[0]?.[0]).toContain('你是什么 llm');
  expect(onSend.mock.calls[0]?.[0]).toContain('attachment://a1');
});

test('Enter during an upload that fails keeps the draft and sends nothing', async () => {
  let finish: (tokens: string[]) => void = () => {};
  const onSend = vi.fn();
  const wire = useComposerWire({
    editable: true,
    draft: '你是什么 llm',
    onDraftChange: vi.fn(),
    onSend,
    onAttachment: () => new Promise<string[]>((resolve) => {
      finish = resolve;
    }),
  });
  wire.attachFiles([new File(['x'], 'shot.png', { type: 'image/png' })]);
  wire.handleKeyDown(keyboard('Enter'));
  await Promise.resolve();
  finish([]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(onSend).not.toHaveBeenCalled();
});

test('active IME composition suppresses Enter send until compositionend', () => {
  const wire = composer();
  wire.handleCompositionStart();
  wire.handleKeyDown(keyboard('Enter'));
  expect(wire.onSend).not.toHaveBeenCalled();
  wire.handleCompositionEnd();
  wire.handleKeyDown(keyboard('Enter'));
  expect(wire.onSend).toHaveBeenCalledExactlyOnceWith('Next message');
});

test('blur during IME composition without compositionend resets composing so subsequent Enter sends', () => {
  const wire = composer();
  wire.handleCompositionStart();
  wire.handleKeyDown(keyboard('Enter'));
  expect(wire.onSend).not.toHaveBeenCalled();
  wire.handleBlur();
  wire.handleKeyDown(keyboard('Enter'));
  expect(wire.onSend).toHaveBeenCalledExactlyOnceWith('Next message');
});

test('compositioncancel resets composing so subsequent Enter sends', () => {
  const wire = composer();
  wire.handleCompositionStart();
  wire.handleKeyDown(keyboard('Enter'));
  expect(wire.onSend).not.toHaveBeenCalled();
  wire.handleCompositionCancel();
  wire.handleKeyDown(keyboard('Enter'));
  expect(wire.onSend).toHaveBeenCalledExactlyOnceWith('Next message');
});

test('non-composing handleChange resets stuck composing while composing or unspecified handleChange preserves it', () => {
  const wire = composer();
  wire.handleCompositionStart();
  wire.handleChange({
    target: { value: 'Next message' },
    nativeEvent: { isComposing: true },
  } as unknown as Parameters<typeof wire.handleChange>[0]);
  wire.handleKeyDown(keyboard('Enter'));
  expect(wire.onSend).not.toHaveBeenCalled();

  wire.handleChange({
    target: { value: 'Next message' },
    nativeEvent: {},
  } as unknown as Parameters<typeof wire.handleChange>[0]);
  wire.handleKeyDown(keyboard('Enter'));
  expect(wire.onSend).not.toHaveBeenCalled();

  wire.handleChange({
    target: { value: 'Next message' },
    nativeEvent: { isComposing: false },
  } as unknown as Parameters<typeof wire.handleChange>[0]);
  wire.handleKeyDown(keyboard('Enter'));
  expect(wire.onSend).toHaveBeenCalledExactlyOnceWith('Next message');
});

test('synchronous Enter clears refs immediately and resists stale-prop re-renders so M2 never merges with M1', () => {
  hooks.reset();
  const sent: string[] = [];
  const draftChanges: string[] = [];
  const render = (draftProp: string) =>
    hooks.run(() =>
      useComposerWire({
        editable: true,
        draft: draftProp,
        onDraftChange: (next) => draftChanges.push(next),
        onSend: (text) => {
          sent.push(text);
        },
        onQueue: vi.fn(),
      }),
    );

  const wire1 = render('First message');
  wire1.handleKeyDown(keyboard('Enter'));
  expect(sent).toEqual(['First message']);
  expect(draftChanges).toEqual(['']);

  const wireStale = render('First message');
  wireStale.setDraft((current) => `${current}Second message`);
  expect(draftChanges.at(-1)).toBe('Second message');

  wireStale.handleKeyDown(keyboard('Enter'));
  expect(sent).toEqual(['First message', 'Second message']);
});

test('async caller preserves M2 typed before M1 promise settles', async () => {
  hooks.reset();
  let resolveM1!: () => void;
  let draftProp = 'First';
  const sent: string[] = [];
  const render = () =>
    hooks.run(() =>
      useComposerWire({
        editable: true,
        draft: draftProp,
        onDraftChange: (next) => {
          draftProp = next;
        },
        onSend: (text) => {
          sent.push(text);
          if (sent.length === 1) {
            return new Promise<void>((resolve) => {
              resolveM1 = resolve;
            });
          }
          return undefined;
        },
        onQueue: vi.fn(),
      }),
    );

  const wire1 = render();
  wire1.handleKeyDown(keyboard('Enter'));
  expect(draftProp).toBe('First');

  wire1.handleChange({
    target: { value: 'Second' },
    nativeEvent: { isComposing: false },
  } as unknown as Parameters<typeof wire1.handleChange>[0]);
  expect(draftProp).toBe('Second');
  render();

  resolveM1();
  await Promise.resolve();
  await Promise.resolve();
  expect(draftProp).toBe('Second');
});

test('failed-send withoutReturnedText restore does not merge new draft text and sendAfterUploadRef / draftSync.refresh preserve input', async () => {
  expect(withoutReturnedText('M1', 'M1')).toBe('');
  expect(withoutReturnedText('M1\nM2', 'M1')).toBe('M2');
  expect(withoutReturnedText('M2\nM1', 'M1')).toBe('M2');

  hooks.reset();
  let resolveUpload: ((tokens: string[]) => void) | undefined;
  let draftProp = 'Attach note';
  const sent: string[] = [];
  const render = () =>
    hooks.run(() =>
      useComposerWire({
        editable: true,
        draft: draftProp,
        onDraftChange: (next) => {
          draftProp = next;
        },
        onSend: (text) => {
          sent.push(text);
        },
        onQueue: vi.fn(),
        onAttachment: () =>
          new Promise<string[]>((resolve) => {
            resolveUpload = resolve;
          }),
      }),
    );

  const w1 = render();
  w1.attachFiles([new File(['x'], 'doc.txt', { type: 'text/plain' })]);
  await vi.waitFor(() => expect(resolveUpload).toBeTypeOf('function'));
  render().handleKeyDown(keyboard('Enter'));
  expect(sent).toEqual([]);

  resolveUpload!(['![doc.txt](attachment:t1/a1.txt)']);
  await vi.waitFor(() =>
    expect(sent).toEqual(['![doc.txt](attachment:t1/a1.txt)\nAttach note']),
  );

  const remoteCalls: string[] = [];
  const mem = new Map<string, string>();
  const sync = new DraftSync({
    transport: {
      load: async () => ({ content: 'stale remote', updatedAt: 1 }),
      save: async () => ({ content: 'live local', updatedAt: 2 }),
    },
    storage: {
      getItem: (k) => mem.get(k) ?? null,
      setItem: (k, v) => {
        mem.set(k, v);
      },
      removeItem: (k) => {
        mem.delete(k);
      },
    },
    localKey: 'test-draft',
    onRemote: (content: string) => remoteCalls.push(content),
  });
  sync.edit('live local');
  await sync.refresh();
  expect(sync.current()).toBe('live local');
  expect(remoteCalls).toEqual([]);
});
