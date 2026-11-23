export interface WindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState {
  bounds: WindowRect | null;
}

export const WINDOW_STATE_FILE_NAME = 'window-state.json';
export const DEFAULT_WINDOW_SIZE = { width: 1280, height: 800 } as const;
export const MIN_WINDOW_SIZE = { width: 760, height: 520 } as const;
export const WINDOW_STATE_SAVE_DELAY_MS = 500;

const MIN_VISIBLE_PX = 64;
const EMPTY_STATE: WindowState = { bounds: null };

function isRect(value: unknown): value is WindowRect {
  if (typeof value !== 'object' || value === null) return false;
  const rect = value as Partial<Record<keyof WindowRect, unknown>>;
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    (rect.width as number) > 0 &&
    (rect.height as number) > 0
  );
}

export function parseWindowState(raw: string | null): WindowState {
  if (raw === null) return EMPTY_STATE;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return EMPTY_STATE;
  }
  if (typeof value !== 'object' || value === null) return EMPTY_STATE;
  const stored = value as Partial<Record<keyof WindowState, unknown>>;
  return {
    bounds: isRect(stored.bounds) ? { ...stored.bounds } : null,
  };
}

export function serializeWindowState(state: WindowState): string {
  return `${JSON.stringify(state)}\n`;
}

function overlap(a: WindowRect, b: WindowRect): { width: number; height: number } {
  return {
    width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
  };
}

function fitInside(bounds: WindowRect, area: WindowRect): WindowRect {
  const width = Math.min(bounds.width, area.width);
  const height = Math.min(bounds.height, area.height);
  return {
    width,
    height,
    x: Math.min(Math.max(bounds.x, area.x), area.x + area.width - width),
    y: Math.min(Math.max(bounds.y, area.y), area.y + area.height - height),
  };
}

export function clampBounds(
  bounds: WindowRect,
  workAreas: readonly WindowRect[],
  primary: WindowRect,
): WindowRect {
  let best: WindowRect | null = null;
  let bestArea = 0;
  for (const area of workAreas) {
    const shared = overlap(bounds, area);
    if (shared.width < MIN_VISIBLE_PX || shared.height < MIN_VISIBLE_PX) continue;
    if (shared.width * shared.height > bestArea) {
      best = area;
      bestArea = shared.width * shared.height;
    }
  }
  if (best !== null) return fitInside(bounds, best);
  const centred = {
    width: Math.min(bounds.width, primary.width),
    height: Math.min(bounds.height, primary.height),
  };
  return {
    ...centred,
    x: primary.x + Math.round((primary.width - centred.width) / 2),
    y: primary.y + Math.round((primary.height - centred.height) / 2),
  };
}

export interface WindowStateStore {
  current(): WindowState;
  update(change: Partial<WindowState>): void;
  flush(): void;
}

export function createWindowStateStore(io: {
  read: () => string | null;
  write: (contents: string) => void;
  delayMs?: number;
}): WindowStateStore {
  let state = parseWindowState(io.read());
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    try {
      io.write(serializeWindowState(state));
    } catch {}
  };
  return {
    current: () => state,
    update(change) {
      state = { ...state, ...change };
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(flush, io.delayMs ?? WINDOW_STATE_SAVE_DELAY_MS);
    },
    flush,
  };
}
