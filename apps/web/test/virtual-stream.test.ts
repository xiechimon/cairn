import type { VirtualItem, VirtualizerOptions } from '@tanstack/react-virtual';
import { afterEach, expect, test, vi } from 'vitest';
import { VirtualStream, type VirtualStreamScrollTarget } from '../src/chief/virtual-stream.js';

type Options = VirtualizerOptions<HTMLDivElement, HTMLElement>;
type Effect = { deps: readonly unknown[] | undefined; cleanup?: (() => void) | undefined };
interface VirtualizerHarness {
  options: Options;
  elementsCache: Map<string, { offsetHeight: number }>;
  readonly scrollOffset: number;
  setOptions: (options: Options) => void;
  scrollToIndex: (index: number, settings: unknown) => void;
  cancelScroll: () => void;
  measureElement: () => void;
  takeSnapshot: () => VirtualItem[];
  scrollRect: null;
  getOffsetForIndex: () => (number | string)[];
  getTotalSize: () => number;
  getVirtualItems: () => VirtualItem[];
  deliverResizeObserver: (index: number, height: number) => void;
}

const hooks = vi.hoisted(() => ({
  effects: [] as Array<() => void>,
  layouts: [] as Effect[],
  refs: [] as Array<{ current: unknown }>,
  states: [] as unknown[],
  cursor: 0,
  refCursor: 0,
  effectCursor: 0,
  mounted: false,
  readerLeft: true,
  padding: 32,
  scrolledOffset: 1168,
  targetOffset: 1200,
  viewport: {
    scrollTop: 1200,
    scrollHeight: 12000,
    getBoundingClientRect: () => ({ top: 0 }),
    addEventListener: vi.fn<(type: string, listener: () => void) => void>(),
    removeEventListener: vi.fn<(type: string, listener: () => void) => void>(),
  },
  node: { offsetHeight: 120 },
  previousNode: { offsetHeight: 120 },
  frames: new Map<number, FrameRequestCallback>(),
  frameId: 0,
  target: undefined as VirtualStreamScrollTarget | undefined,
  virtualizer: undefined as VirtualizerHarness | undefined,
  scrollToIndex: vi.fn(),
  cancelScroll: vi.fn(),
  scrollToEnd: vi.fn(),
}));
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useLayoutEffect: (effect: () => unknown, deps?: readonly unknown[]) => {
    const index = hooks.effectCursor++;
    const previous = hooks.layouts[index];
    if (deps !== undefined && previous?.deps !== undefined &&
      deps.length === previous.deps.length && deps.every((value, i) => Object.is(value, previous.deps?.[i]))) return;
    hooks.effects.push(() => {
      previous?.cleanup?.();
      const cleanup = effect();
      hooks.layouts[index] = { deps, cleanup: typeof cleanup === 'function' ? cleanup as () => void : undefined };
    });
  },
  useCallback: (callback: unknown) => callback,
  useRef: (current: unknown) => {
    const index = hooks.refCursor++;
    hooks.refs[index] ??= { current };
    return hooks.refs[index];
  },
  useState: (value: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.states)) hooks.states[index] = typeof value === 'function' ? value() : value;
    return [hooks.states[index], (next: unknown) => { hooks.states[index] = next; }];
  },
}));
vi.mock('@tanstack/react-virtual', () => ({
  defaultRangeExtractor: () => [],
  measureElement: (node: HTMLElement, entry?: ResizeObserverEntry) =>
    entry?.borderBoxSize[0]?.blockSize ?? node.offsetHeight,
  useVirtualizer: (options: Options) => {
    hooks.virtualizer ??= makeVirtualizer(options);
    hooks.virtualizer.setOptions(options);
    return hooks.virtualizer;
  },
}));
vi.mock('../src/components/ui/message-scroller.js', () => ({
  useMessageScrollerScrollable: () => ({ end: false }),
  useMessageScroller: () => ({ scrollToEnd: hooks.scrollToEnd }),
}));
vi.mock('../src/chief/reader-follow.js', () => ({ useReaderLeft: () => hooks.readerLeft }));

function makeVirtualizer(options: Options): VirtualizerHarness {
  const items: VirtualItem[] = [11, 12].map((index) => ({
    index, key: `row-${index}`, start: index * 120, end: (index + 1) * 120, lane: 0, size: 120,
  }));
  const elementsCache = new Map([['row-11', hooks.previousNode], ['row-12', hooks.node]]);
  return {
    options,
    elementsCache,
    get scrollOffset() { return hooks.scrolledOffset; },
    setOptions(next: Options) { this.options = next; },
    scrollToIndex: (index: number, settings: unknown) => hooks.scrollToIndex(index, settings, hooks.virtualizer?.options.scrollPaddingStart),
    cancelScroll: hooks.cancelScroll,
    measureElement: vi.fn(),
    getOffsetForIndex() { return [hooks.targetOffset - (this.options.scrollPaddingStart ?? 0), 'start']; },
    takeSnapshot: () => items,
    scrollRect: null,
    getTotalSize: () => 12000,
    getVirtualItems: () => hooks.mounted ? items : [],
    deliverResizeObserver(index: number, height: number) {
      const node = elementsCache.get(`row-${index}`)!;
      const entry = { target: node, borderBoxSize: [{ blockSize: height }] };
      const measured = this.options.measureElement?.(
        node as HTMLElement, entry as unknown as ResizeObserverEntry,
        this as unknown as Parameters<NonNullable<Options['measureElement']>>[2],
      ) ?? height;
      if (index === 11) hooks.targetOffset += measured - items[0]!.size;
      items[index - 11]!.size = measured;
    },
  };
}

afterEach(() => {
  for (const layout of hooks.layouts) layout.cleanup?.();
  hooks.effects.length = 0;
  hooks.layouts.length = 0;
  hooks.refs.length = 0;
  hooks.states.length = 0;
  hooks.mounted = false;
  hooks.readerLeft = true;
  hooks.padding = 32;
  hooks.scrolledOffset = 1168;
  hooks.targetOffset = 1200;
  hooks.viewport.scrollTop = 1200;
  hooks.target = undefined;
  hooks.virtualizer = undefined;
  hooks.frames.clear();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const viewportRef = { current: hooks.viewport as unknown as HTMLDivElement };

function render(onMounted?: (node: HTMLElement) => void, count = 100) {
  hooks.cursor = 0;
  hooks.refCursor = 0;
  hooks.effectCursor = 0;
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => `${hooks.padding}px` }));
  vi.stubGlobal('requestAnimationFrame', (frame: FrameRequestCallback) => {
    const id = ++hooks.frameId;
    hooks.frames.set(id, frame);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => hooks.frames.delete(id));
  if (onMounted === undefined) hooks.target = undefined;
  else if (hooks.target?.onMounted !== onMounted) hooks.target = { index: 12, onMounted };
  VirtualStream({
    cacheKey: '',
    keys: Array.from({ length: count }, (_, index) => `row-${index}`),
    renderRow: () => null,
    viewportRef,
    ...(hooks.target === undefined ? {} : { scrollTarget: hooks.target }),
  });
  hooks.refs[0]!.current = {
    getBoundingClientRect: () => ({ top: 0 }),
    querySelector: (selector: string) => {
      expect(selector).toBe('[data-index="12"]');
      return hooks.mounted ? hooks.node : null;
    },
  };
  for (const effect of hooks.effects.splice(0)) effect();
}

function frame() {
  const callbacks = [...hooks.frames.values()];
  hooks.frames.clear();
  for (const callback of callbacks) callback(0);
}

test('a Tasks jump waits for delayed ResizeObserver measurements and two stable frames', () => {
  const onMounted = vi.fn();
  hooks.scrolledOffset = 6000;
  render(onMounted);
  hooks.mounted = true;
  hooks.viewport.scrollTop = 1168;
  hooks.scrolledOffset = 1168;
  render(onMounted);
  expect(hooks.scrollToIndex).toHaveBeenCalledExactlyOnceWith(12, { align: 'start' }, 32);
  frame();
  frame();
  expect(onMounted).not.toHaveBeenCalled();
  expect(hooks.frames.size).toBe(0);

  hooks.virtualizer!.deliverResizeObserver(12, 120);
  frame();
  frame();
  expect(onMounted).not.toHaveBeenCalled();

  hooks.virtualizer!.deliverResizeObserver(11, 160);
  hooks.viewport.scrollTop = 1208;
  frame();
  expect(onMounted).not.toHaveBeenCalled();
  hooks.scrolledOffset = 1208;
  hooks.viewport.addEventListener.mock.lastCall?.[1]();
  frame();
  expect(onMounted).not.toHaveBeenCalled();

  hooks.virtualizer!.deliverResizeObserver(11, 170);
  hooks.viewport.scrollTop = 1218;
  hooks.scrolledOffset = 1218;
  frame();
  expect(onMounted).not.toHaveBeenCalled();
  frame();
  expect(onMounted).toHaveBeenCalledExactlyOnceWith(hooks.node);
  expect(hooks.viewport.removeEventListener).toHaveBeenCalledWith('scroll', hooks.viewport.addEventListener.mock.lastCall?.[1]);
  expect(hooks.cancelScroll).not.toHaveBeenCalled();
  expect(hooks.scrollToIndex).toHaveBeenCalledOnce();
});

test.each([120, 128, 32])('a second jump reads the current %ipx layout padding and positions exactly once', (padding) => {
  const first = vi.fn();
  render(first);
  render(first);
  render();
  hooks.scrollToIndex.mockClear();
  hooks.padding = padding;
  render();
  expect(hooks.scrollToIndex).not.toHaveBeenCalled();
  const second = vi.fn();
  render(second);
  render(second);
  expect(hooks.scrollToIndex).toHaveBeenCalledExactlyOnceWith(12, { align: 'start' }, padding);
  render(second);
  frame();
  expect(hooks.scrollToIndex).toHaveBeenCalledOnce();
});

test('appending only snaps to the end while bottom following is armed', () => {
  render(undefined, 100);
  render(undefined, 101);
  expect(hooks.viewport.scrollTop).toBe(1200);
  expect(hooks.scrollToEnd).not.toHaveBeenCalled();
  hooks.readerLeft = false;
  render(undefined, 102);
  expect(hooks.scrollToEnd).toHaveBeenCalledOnce();
});
