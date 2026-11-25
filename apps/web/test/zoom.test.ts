import { describe, expect, test } from 'vitest';
import {
  nextPinchZoom,
  stepZoom,
  zoomAnchorRatio,
  zoomAnchorScroll,
  zoomShortcutAction,
} from '../src/board/artifact/viewers/zoom.js';

describe('zoom math and shortcuts', () => {
  test('stepZoom steps up and down including sub-25% fit scales', () => {
    expect(stepZoom(1, 1)).toBe(1.25);
    expect(stepZoom(1, -1)).toBe(0.75);
    expect(stepZoom(0.18, -1)).toBe(0.1);
    expect(stepZoom(0.18, 1)).toBe(0.25);
    expect(stepZoom(4, 1)).toBe(4);
  });

  test('nextPinchZoom scales smoothly on ctrl+wheel and clamps within bounds', () => {
    expect(nextPinchZoom(1, -50, 0)).toBeGreaterThan(1.5);
    expect(nextPinchZoom(1, 50, 0)).toBeLessThan(0.7);
    expect(nextPinchZoom(4, -100, 0)).toBe(4);
    expect(nextPinchZoom(0.1, 100, 0)).toBe(0.1);
    expect(nextPinchZoom(1, -3, 1)).toBeGreaterThan(1.4);
  });

  test('zoomAnchorScroll keeps the cursor point stationary across scale changes', () => {
    const anchor = zoomAnchorRatio({
      clientX: 350,
      clientY: 150,
      stageRect: { left: 0, top: 0 },
      contentRect: { left: 50, top: 50, width: 400, height: 400 },
    });
    expect(anchor).toEqual({ relX: 0.75, relY: 0.25, pointerX: 350, pointerY: 150 });
    expect(
      zoomAnchorScroll({
        anchor,
        stageRect: { left: 0, top: 0 },
        contentRect: { left: 8, top: 8, width: 1000, height: 1000 },
        scrollLeft: 0,
        scrollTop: 0,
      }),
    ).toEqual({ left: 408, top: 108 });
  });

  test('zoomShortcutAction recognizes Cmd/Ctrl +, -, 0 and ignores non-modifier or Alt combos', () => {
    expect(zoomShortcutAction({ key: '=', code: 'Equal', metaKey: true, ctrlKey: false, altKey: false })).toBe('in');
    expect(zoomShortcutAction({ key: '+', code: 'Equal', metaKey: false, ctrlKey: true, altKey: false })).toBe('in');
    expect(zoomShortcutAction({ key: '+', code: 'NumpadAdd', metaKey: true, ctrlKey: false, altKey: false })).toBe('in');
    expect(zoomShortcutAction({ key: '-', code: 'Minus', metaKey: true, ctrlKey: false, altKey: false })).toBe('out');
    expect(zoomShortcutAction({ key: '_', code: 'Minus', metaKey: false, ctrlKey: true, altKey: false })).toBe('out');
    expect(zoomShortcutAction({ key: '0', code: 'Digit0', metaKey: true, ctrlKey: false, altKey: false })).toBe('fit');
    expect(zoomShortcutAction({ key: '0', code: 'Numpad0', metaKey: false, ctrlKey: true, altKey: false })).toBe('fit');
    expect(zoomShortcutAction({ key: '0', code: 'Digit0', metaKey: true, ctrlKey: false, altKey: true })).toBeNull();
    expect(zoomShortcutAction({ key: '0', code: 'Digit0', metaKey: false, ctrlKey: false, altKey: false })).toBeNull();
  });
});
