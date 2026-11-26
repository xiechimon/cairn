export interface ComposerBinding {
  draft: string;
  setDraft?: (value: string) => void;
}

export function serverDraftBinding(
  draft: string,
  setDraft: ((value: string) => void) | undefined,
): ComposerBinding {
  return setDraft === undefined ? { draft } : { draft, setDraft };
}
