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
let focusIndex = 0;
const answers = new Map<string, string>();

export function answerKeyOf(draftKey: string, step: number): string {
  return `${draftKey}#${step}`;
}

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
  focus(): number {
    return focusIndex;
  },
  setFocus(next: number): void {
    if (next === focusIndex) return;
    focusIndex = next;
    emit();
  },
  answerText(key: string): string {
    return answers.get(key) ?? '';
  },
  setAnswerText(key: string, text: string): void {
    if ((answers.get(key) ?? '') === text) return;
    if (text === '') answers.delete(key);
    else answers.set(key, text);
    emit();
  },
  clearAnswers(draftKey: string): void {
    let changed = false;
    for (const key of [...answers.keys()]) {
      if (!key.startsWith(`${draftKey}#`)) continue;
      answers.delete(key);
      changed = true;
    }
    if (changed) emit();
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
