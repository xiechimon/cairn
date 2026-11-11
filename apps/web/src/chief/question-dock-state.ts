import { toast } from 'sonner';

type Listener = () => void;

export type QuestionPrimary = {
  requestId: string;
  last: boolean;
  enabled: boolean;
  advance: () => void;
};

const DISMISS_UNDO_MS = 5000;

const dismissing = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<Listener>();
let version = 0;
let primary: QuestionPrimary | null = null;
let focusIndex = 0;
let uploads = 0;
let reveals = 0;
const answers = new Map<string, string>();
const closed = new Set<string>();

export function answerKeyOf(draftKey: string, step: number): string {
  return `${draftKey}#${step}`;
}

export function draftKeyOfAnswer(answerKey: string): string {
  return answerKey.slice(0, answerKey.lastIndexOf('#'));
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
  uploading(): boolean {
    return uploads > 0;
  },
  beginUpload(): void {
    uploads += 1;
    if (uploads === 1) emit();
  },
  endUpload(): void {
    if (uploads === 0) return;
    uploads -= 1;
    if (uploads === 0) emit();
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
  isClosed(draftKey: string): boolean {
    return closed.has(draftKey);
  },
  clearAnswers(draftKey: string): void {
    closed.add(draftKey);
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
  reveals(): number {
    return reveals;
  },
  reveal(): void {
    reveals += 1;
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
