import { toast } from 'sonner';
import { safeLocalStorage, safeSetItem } from '../safe-storage.js';

type Listener = () => void;

export type QuestionPrimary = {
  requestId: string;
  last: boolean;
  enabled: boolean;
  advance: () => void;
};

const DISMISS_UNDO_MS = 5000;

const COLLAPSED_KEY = 'cairn-question-collapsed';

function loadCollapsed(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(safeLocalStorage()?.getItem(COLLAPSED_KEY) ?? '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

const collapsed = loadCollapsed();

function saveCollapsed(): void {
  safeSetItem(COLLAPSED_KEY, JSON.stringify([...collapsed]));
}
const dismissing = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<Listener>();
let version = 0;
let primary: QuestionPrimary | null = null;

function emit(): void {
  version += 1;
  for (const listener of listeners) listener();
}

export const questionDockState = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  snapshot(): number {
    return version;
  },
  primary(): QuestionPrimary | null {
    return primary;
  },
  setPrimary(next: QuestionPrimary): void {
    const same =
      primary?.requestId === next.requestId &&
      primary.last === next.last &&
      primary.enabled === next.enabled;
    primary = next;
    if (!same) emit();
  },
  clearPrimary(requestId: string): void {
    if (primary?.requestId !== requestId) return;
    primary = null;
    emit();
  },
  isCollapsed(requestId: string): boolean {
    return collapsed.has(requestId);
  },
  toggleCollapsed(requestId: string): void {
    if (!collapsed.delete(requestId)) collapsed.add(requestId);
    saveCollapsed();
    emit();
  },
  forgetCollapsed(requestId: string): void {
    if (!collapsed.delete(requestId)) return;
    saveCollapsed();
    emit();
  },
  isDismissing(requestId: string): boolean {
    return dismissing.has(requestId);
  },
  dismissWithUndo(
    requestId: string,
    copy: { title: string; undo: string },
    commit: () => void,
  ): void {
    if (dismissing.has(requestId)) return;
    const timer = setTimeout(() => {
      dismissing.delete(requestId);
      emit();
      commit();
    }, DISMISS_UNDO_MS);
    dismissing.set(requestId, timer);
    emit();
    toast(copy.title, {
      duration: DISMISS_UNDO_MS,
      action: {
        label: copy.undo,
        onClick: () => {
          clearTimeout(dismissing.get(requestId));
          dismissing.delete(requestId);
          emit();
        },
      },
    });
  },
};
