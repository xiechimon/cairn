export interface ComposerBinding {
  draft: string;
  setDraft?: (value: string) => void;
  readDraft?: () => string;
}

export interface KeyedDraftStore {
  get(key: string): string;
  set(key: string, value: string): void;
}

export interface KeyedComposerBinding extends ComposerBinding {
  setDraft: (value: string) => void;
  readDraft: () => string;
}

export function serverDraftBinding(
  draft: string,
  setDraft: ((value: string) => void) | undefined,
): ComposerBinding {
  return setDraft === undefined ? { draft } : { draft, setDraft };
}

export function keyedBinding(store: KeyedDraftStore, key: string): KeyedComposerBinding {
  return {
    draft: store.get(key),
    setDraft: (value) => store.set(key, value),
    readDraft: () => store.get(key),
  };
}
