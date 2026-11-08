export const BAR_GAP = 8;
export const BAR_EDGE = 12;
export const SCROLL_DISMISS = 100;
export const SETTLE_MS = 250;
export const REPLY_SOURCE_ATTR = 'data-reply-source';

export interface LineBox {
  left: number;
  width: number;
  top: number;
  bottom: number;
}

export interface BarSize {
  width: number;
  height: number;
}

export interface Bounds {
  left: number;
  right: number;
  top: number;
}

export function barPosition(line: LineBox, bar: BarSize, bounds: Bounds): { x: number; y: number } {
  const half = bar.width / 2 + BAR_EDGE;
  const centre = line.left + line.width / 2;
  const x = Math.round(Math.min(Math.max(centre, bounds.left + half), bounds.right - half));
  const above = line.top - bar.height - BAR_GAP;
  const y = Math.round(above >= bounds.top + BAR_EDGE ? above : line.bottom + BAR_GAP);
  return { x, y };
}

export function replyableText(raw: string): string | null {
  const text = raw.trim();
  return text.length < 2 ? null : text;
}

export function scrolledAway(shownTop: number, currentTop: number): boolean {
  return Math.abs(currentTop - shownTop) > SCROLL_DISMISS;
}
