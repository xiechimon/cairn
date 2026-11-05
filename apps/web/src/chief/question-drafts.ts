export type QuestionDraft =
  | { kind: 'choices'; picked: string[]; other: boolean; otherText: string }
  | { kind: 'text'; value: string };

export type QuestionDraftRecord = {
  drafts: QuestionDraft[];
  step: number;
  submitting: boolean;
  error: string | null;
};

export type QuestionPrompt = {
  options: { label: string }[];
  multiSelect?: boolean;
};

type Listener = () => void;

const records = new Map<string, QuestionDraftRecord>();
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function questionDraftKey(parts: {
  teamId: string;
  conversationId: string;
  requestId: string;
}): string {
  return JSON.stringify([parts.teamId, parts.conversationId, parts.requestId]);
}

export function questionActionThread(
  originThreadId: string | undefined,
  activeThreadId: string | null,
): string | null {
  return originThreadId ?? activeThreadId;
}

export function emptyQuestionDrafts(questions: readonly QuestionPrompt[]): QuestionDraft[] {
  return questions.map((question) =>
    question.options.length === 0
      ? { kind: 'text' as const, value: '' }
      : { kind: 'choices' as const, picked: [], other: false, otherText: '' },
  );
}

export function questionDraftComplete(
  draft: QuestionDraft | undefined,
  question: QuestionPrompt | undefined,
): boolean {
  if (draft === undefined || question === undefined) return false;
  if (draft.kind === 'text') return draft.value.trim() !== '';
  return draft.picked.length >= 1 || (draft.other && draft.otherText.trim() !== '');
}

function replaceDraft(prev: QuestionDraft[], index: number, next: QuestionDraft): QuestionDraft[] {
  const copy = [...prev];
  copy[index] = next;
  return copy;
}

export function applyQuestionPick(
  prev: QuestionDraft[],
  index: number,
  question: QuestionPrompt,
  optionIndex: number,
): QuestionDraft[] {
  const current = prev[index];
  if (current?.kind !== 'choices') return prev;
  if (optionIndex === question.options.length) {
    if (question.multiSelect === true)
      return replaceDraft(prev, index, { ...current, other: !current.other });
    return replaceDraft(prev, index, { ...current, picked: [], other: true });
  }
  const label = question.options[optionIndex]?.label;
  if (label === undefined) return prev;
  if (question.multiSelect === true) {
    const picked = current.picked.includes(label)
      ? current.picked.filter((item) => item !== label)
      : [...current.picked, label];
    return replaceDraft(prev, index, { ...current, picked });
  }
  return replaceDraft(prev, index, { ...current, picked: [label], other: false });
}

export function replaceQuestionDraft(
  prev: QuestionDraft[],
  index: number,
  next: QuestionDraft,
): QuestionDraft[] {
  return replaceDraft(prev, index, next);
}

export const questionDraftStore = {
  get(key: string): QuestionDraftRecord | undefined {
    return records.get(key);
  },
  set(key: string, record: QuestionDraftRecord): void {
    records.set(key, record);
    emit();
  },
  patch(key: string, partial: Partial<QuestionDraftRecord>): void {
    const current = records.get(key) ?? {
      drafts: [],
      step: 0,
      submitting: false,
      error: null,
    };
    records.set(key, { ...current, ...partial });
    emit();
  },
  clear(key: string): void {
    if (!records.delete(key)) return;
    emit();
  },
  clearAll(): void {
    if (records.size === 0) return;
    records.clear();
    emit();
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
