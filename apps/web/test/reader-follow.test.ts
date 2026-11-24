import { afterEach, describe, expect, it, vi } from 'vitest';
import { useReaderFollow, whenHeightSettles } from '../src/chief/reader-follow.js';

const { setReaderLeft, scrollToEnd } = vi.hoisted(() => ({
  setReaderLeft: vi.fn(),
  scrollToEnd: vi.fn(),
}));

vi.mock('../src/components/ui/message-scroller.js', () => ({
  useMessageScroller: () => ({ scrollToEnd }),
}));

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useContext: () => ({ setReaderLeft }),
  useMemo: (factory: () => unknown) => factory(),
  useRef: (current: unknown) => ({ current }),
}));

describe('a reader jump', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setReaderLeft.mockClear();
    scrollToEnd.mockReset();
  });

  it('discards old input intent and rearms only after a new scroll reaches the bottom', () => {
    const reader = useReaderFollow();
    const viewport = { scrollHeight: 1000, scrollTop: 500, clientHeight: 200 } as HTMLDivElement;
    const wheel = { currentTarget: viewport, deltaY: 100 } as React.WheelEvent<HTMLDivElement>;
    const scroll = { currentTarget: viewport } as React.UIEvent<HTMLDivElement>;
    reader.viewportProps.onWheel(wheel);
    reader.pause();
    expect(setReaderLeft.mock.calls).toEqual([[true]]);
    reader.viewportProps.onPointerDown({
      currentTarget: viewport,
      target: {},
    } as React.PointerEvent<HTMLDivElement>);
    viewport.scrollTop = 800;
    reader.viewportProps.onScroll(scroll);
    expect(setReaderLeft.mock.calls).toEqual([[true]]);
    viewport.scrollTop = 500;
    reader.viewportProps.onWheel(wheel);
    reader.viewportProps.onScroll(scroll);
    expect(setReaderLeft.mock.calls).toEqual([[true]]);
    viewport.scrollTop = 800;
    reader.viewportProps.onScroll(scroll);
    expect(setReaderLeft.mock.calls).toEqual([[true], [false]]);
  });

  it.each(['End', 'ArrowDown', 'PageDown', ' '])(
    'rearms on %s at the bottom without waiting for a scroll event',
    (key) => {
      const reader = useReaderFollow();
      const viewport = { scrollHeight: 1000, scrollTop: 800, clientHeight: 200 } as HTMLDivElement;
      reader.pause();
      reader.viewportProps.onKeyDown({ currentTarget: viewport, target: viewport, key, preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLDivElement>);
      expect(setReaderLeft.mock.calls).toEqual([[true], [false]]);
    },
  );

  it('End explicitly leaves a jump anchor and reaches the end before lazy rows finish measuring', () => {
    const reader = useReaderFollow();
    const viewport = { scrollHeight: 1000, scrollTop: 500, clientHeight: 200 } as HTMLDivElement;
    const preventDefault = vi.fn();
    scrollToEnd.mockImplementation(() => { viewport.scrollTop = viewport.scrollHeight - viewport.clientHeight; });
    reader.pause();
    reader.viewportProps.onKeyDown({ currentTarget: viewport, target: viewport, key: 'End', preventDefault } as unknown as React.KeyboardEvent<HTMLDivElement>);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(setReaderLeft.mock.calls).toEqual([[true], [false]]);
    expect(scrollToEnd).toHaveBeenCalledExactlyOnceWith({ behavior: 'instant' });
    expect(viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight).toBe(0);
  });

  function keyFromQuestionRow(selector: string, key: string, modifiers: { shiftKey?: boolean; defaultPrevented?: boolean } = {}) {
    class Target {
      matches(query: string) { return query.split(',').some((part) => part.trim() === selector); }
    }
    vi.stubGlobal('Element', Target);
    const reader = useReaderFollow();
    const viewport = { scrollHeight: 1000, scrollTop: 500, clientHeight: 200 } as HTMLDivElement;
    const preventDefault = vi.fn();
    reader.pause();
    reader.viewportProps.onKeyDown({ currentTarget: viewport, target: new Target(), key, preventDefault, ...modifiers } as unknown as React.KeyboardEvent<HTMLDivElement>);
    return preventDefault;
  }

  it.each(['button[data-question-row]', '[role="checkbox"][data-question-row]'])('End on a focused %s resumes conversation following', (selector) => {
    const preventDefault = keyFromQuestionRow(selector, 'End');
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(setReaderLeft.mock.calls).toEqual([[true], [false]]);
    expect(scrollToEnd).toHaveBeenCalledExactlyOnceWith({ behavior: 'instant' });
  });

  it.each(['input[data-question-row]', 'textarea', 'button', '[contenteditable]'])('End in a nested %s does not resume conversation following', (selector) => {
    const preventDefault = keyFromQuestionRow(selector, 'End');
    expect(setReaderLeft.mock.calls).toEqual([[true]]);
    expect(scrollToEnd).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it.each([
    { key: 'ArrowDown' },
    { key: 'End', shiftKey: true },
    { key: 'End', defaultPrevented: true },
  ])('leaves other option keyboard actions alone: %j', ({ key, ...modifiers }) => {
    expect(keyFromQuestionRow('button[data-question-row]', key, modifiers)).not.toHaveBeenCalled();
    expect(scrollToEnd).not.toHaveBeenCalled();
  });

  it('checks the current position on a downward wheel rather than the last scroll position', () => {
    const reader = useReaderFollow();
    const viewport = { scrollHeight: 1000, scrollTop: 500, clientHeight: 200 } as HTMLDivElement;
    reader.pause();
    const wheel = { currentTarget: viewport, deltaY: 100 } as React.WheelEvent<HTMLDivElement>;
    reader.viewportProps.onWheel(wheel);
    expect(setReaderLeft.mock.calls).toEqual([[true]]);
    viewport.scrollTop = 800;
    reader.viewportProps.onWheel(wheel);
    expect(setReaderLeft.mock.calls).toEqual([[true], [false]]);
  });

  it('rearms on a downward touch at the bottom without a scroll event', () => {
    const reader = useReaderFollow();
    const viewport = { scrollHeight: 1000, scrollTop: 800, clientHeight: 200 } as HTMLDivElement;
    reader.pause();
    reader.viewportProps.onTouchStart({ currentTarget: viewport, touches: [{ clientY: 100 }] } as unknown as React.TouchEvent<HTMLDivElement>);
    reader.viewportProps.onTouchMove({ currentTarget: viewport, touches: [{ clientY: 80 }] } as unknown as React.TouchEvent<HTMLDivElement>);
    expect(setReaderLeft.mock.calls).toEqual([[true], [false]]);
  });

  it('does not let a disclosure rearm following during a jump pause', () => {
    const reader = useReaderFollow();
    const viewport = { scrollHeight: 1000, scrollTop: 500, clientHeight: 200 };
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
    class Disclosure {
      closest() { return this; }
      getAttribute() { return 'true'; }
    }
    vi.stubGlobal('Element', Disclosure);
    const click = {
      currentTarget: viewport,
      target: new Disclosure(),
    } as unknown as React.MouseEvent<HTMLDivElement>;
    reader.viewportProps.onClickCapture(click);
    reader.pause();
    reader.viewportProps.onClickCapture(click);
    expect(frames).toHaveLength(1);
    viewport.scrollHeight = 700;
    for (let i = 0; i < 4; i += 1) frames.shift()?.(i);
    expect(frames).toHaveLength(0);
    expect(setReaderLeft.mock.calls).toEqual([[true], [true], [true]]);
  });
});

const fakeNode = (scrollHeight: number) => ({ scrollHeight });

describe('whenHeightSettles', () => {
  let pending: FrameRequestCallback[] = [];
  const frame = () => {
    const cbs = pending;
    pending = [];
    for (const cb of cbs) cb(0);
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    pending = [];
  });

  const stubFrames = () => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      pending.push(cb);
      return pending.length;
    });
  };

  it('waits for the height to actually change before counting settled frames', () => {
    stubFrames();
    const node = fakeNode(1000);
    let called = 0;
    whenHeightSettles(node, () => {
      called += 1;
    });
    for (let i = 0; i < 6; i += 1) frame();
    expect(called).toBe(0);
    node.scrollHeight = 400;
    for (let i = 0; i < 4; i += 1) frame();
    expect(called).toBe(1);
  });

  it('settles quickly once the new height holds still', () => {
    stubFrames();
    const node = fakeNode(1000);
    let called = 0;
    whenHeightSettles(node, () => {
      called += 1;
    });
    frame();
    node.scrollHeight = 400;
    for (let i = 0; i < 4; i += 1) frame();
    expect(called).toBe(1);
  });

  it('gives up at the frame cap when the height never changes', () => {
    stubFrames();
    const node = fakeNode(800);
    let called = 0;
    whenHeightSettles(node, () => {
      called += 1;
    });
    for (let i = 0; i < 119; i += 1) frame();
    expect(called).toBe(0);
    frame();
    expect(called).toBe(1);
  });
});
