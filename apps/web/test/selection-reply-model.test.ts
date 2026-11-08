import { describe, expect, test } from 'vitest';
import {
  BAR_EDGE,
  BAR_GAP,
  barPosition,
  replyableText,
  SCROLL_DISMISS,
  scrolledAway,
} from '../src/chief/selection-reply-model.js';

const bounds = { left: 100, right: 700, top: 50 };
const bar = { width: 80, height: 28 };

describe('barPosition', () => {
  test('centres the bar over the first selected line, above it', () => {
    const line = { left: 300, width: 100, top: 400, bottom: 420 };
    expect(barPosition(line, bar, bounds)).toEqual({ x: 350, y: 400 - 28 - BAR_GAP });
  });

  test('keeps the bar inside the conversation edges', () => {
    const atLeft = { left: 90, width: 20, top: 400, bottom: 420 };
    const atRight = { left: 690, width: 40, top: 400, bottom: 420 };
    expect(barPosition(atLeft, bar, bounds).x).toBe(100 + 40 + BAR_EDGE);
    expect(barPosition(atRight, bar, bounds).x).toBe(700 - 40 - BAR_EDGE);
  });

  test('drops below the line when there is no room above it', () => {
    const nearTop = { left: 300, width: 100, top: 70, bottom: 90 };
    expect(barPosition(nearTop, bar, bounds).y).toBe(90 + BAR_GAP);
  });
});

describe('replyableText', () => {
  test('trims and needs at least two characters', () => {
    expect(replyableText('  ok  ')).toBe('ok');
    expect(replyableText(' a ')).toBeNull();
    expect(replyableText('\n\n')).toBeNull();
  });
});

describe('scrolledAway', () => {
  test('dismisses only after the selection moved more than the limit', () => {
    expect(scrolledAway(500, 500 - SCROLL_DISMISS)).toBe(false);
    expect(scrolledAway(500, 500 + SCROLL_DISMISS + 1)).toBe(true);
  });
});
