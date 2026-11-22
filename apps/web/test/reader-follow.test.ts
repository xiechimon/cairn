import { afterEach, describe, expect, it, vi } from 'vitest';
import { whenHeightSettles } from '../src/chief/reader-follow.js';

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
