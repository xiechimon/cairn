import { safeLocalStorage } from '../safe-storage.js';

export type QuestionDraft =
  | { kind: 'choices'; picked: string[]; other: boolean; otherText: string }
  | { kind: 'text'; value: string };

export type QuestionDraftRecord = {
  drafts: QuestionDraft[];
  step: number;
};

export type QuestionSubmitState = {
  submitting: boolean;
  error: string | null;
};

export type QuestionPrompt = {
  options: { label: string }[];
  multiSelect?: boolean;
};

type Listener = () => void;

const STORAGE_KEY = 'cairn.question-drafts.v1';

function isQuestionDraft(value: unknown): value is QuestionDraft {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === 'text') {
    return typeof candidate.value === 'string';
  }
  if (candidate.kind === 'choices') {
    return (
      Array.isArray(candidate.picked) &&
      candidate.picked.every((item) => typeof item === 'string') &&
      typeof candidate.other === 'boolean' &&
      typeof candidate.otherText === 'string'
    );
  }
  return false;
}

function isQuestionDraftRecord(value: unknown): value is QuestionDraftRecord {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.step === 'number' &&
    Number.isInteger(candidate.step) &&
    candidate.step >= 0 &&
    Array.isArray(candidate.drafts) &&
    candidate.drafts.every(isQuestionDraft)
  );
}

function loadStoredRecords(): Map<string, QuestionDraftRecord> {
  const out = new Map<string, QuestionDraftRecord>();
  try {
    const raw = safeLocalStorage()?.getItem(STORAGE_KEY);
    if (raw == null || raw === '') return out;
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return out;
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isQuestionDraftRecord(value)) out.set(key, value);
    }
  } catch {}
  return out;
}

function persistRecords(map: Map<string, QuestionDraftRecord>): void {
  try {
    const storage = safeLocalStorage();
    if (storage === null) return;
    if (map.size === 0) {
      storage.removeItem(STORAGE_KEY);
      return;
    }
    storage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(map)));
  } catch {}
}

const records = loadStoredRecords();
const submits = new Map<string, QuestionSubmitState>();
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
    persistRecords(records);
    emit();
  },
  clear(key: string): void {
    if (!records.delete(key)) return;
    persistRecords(records);
    emit();
  },
  clearAll(): void {
    const had = records.size > 0;
    records.clear();
    persistRecords(records);
    if (!had) return;
    emit();
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export const questionSubmitStore = {
  get(key: string): QuestionSubmitState {
    return submits.get(key) ?? { submitting: false, error: null };
  },
  patch(key: string, partial: Partial<QuestionSubmitState>): void {
    submits.set(key, { ...questionSubmitStore.get(key), ...partial });
    emit();
  },
  clear(key: string): void {
    if (!submits.delete(key)) return;
    emit();
  },
  clearAll(): void {
    if (submits.size === 0) return;
    submits.clear();
    emit();
  },
};
