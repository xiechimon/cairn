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
const uploads = new Map<string, number>();
let approvalReveal: { requestId: string } | null = null;
const answers = new Map<string, string>();
const closed = new Set<string>();
const collapsed = new Set<string>();
let focusRowRequest: string | null = null;
let scrollToRequest: string | null = null;

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
  uploading(draftKey?: string): boolean {
    return draftKey === undefined ? uploads.size > 0 : uploads.has(draftKey);
  },
  beginUpload(draftKey: string): void {
    const count = uploads.get(draftKey) ?? 0;
    uploads.set(draftKey, count + 1);
    if (count === 0) emit();
  },
  endUpload(draftKey: string): void {
    const count = uploads.get(draftKey) ?? 0;
    if (count === 0) return;
    if (count > 1) uploads.set(draftKey, count - 1);
    else {
      uploads.delete(draftKey);
      emit();
    }
  },
  focus(): number {
    return focusIndex;
  },
  setFocus(next: number): void {
    if (next === focusIndex || uploads.size > 0) return;
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
  isCollapsed(requestId: string): boolean {
    return collapsed.has(requestId);
  },
  collapse(requestId: string): void {
    if (collapsed.has(requestId)) return;
    collapsed.add(requestId);
    emit();
  },
  expand(requestId: string, options: { focusRow: boolean }): void {
    if (options.focusRow) focusRowRequest = requestId;
    if (!collapsed.delete(requestId) && !options.focusRow) return;
    emit();
  },
  takeFocusRow(requestId: string): boolean {
    if (focusRowRequest !== requestId) return false;
    focusRowRequest = null;
    return true;
  },
  requestScrollTo(requestId: string): void {
    scrollToRequest = requestId;
    emit();
  },
  takeScrollTo(): string | null {
    const request = scrollToRequest;
    scrollToRequest = null;
    return request;
  },
  isClosed(draftKey: string): boolean {
    return closed.has(draftKey);
  },
  clearAnswers(draftKey: string): void {
    closed.add(draftKey);
    let changed = false;
    for (const key of answers.keys()) {
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
  approvalReveal(): { requestId: string } | null {
    return approvalReveal;
  },
  revealApproval(requestId: string): void {
    approvalReveal = { requestId };
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
