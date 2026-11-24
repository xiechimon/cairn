export function hasClipboard(): boolean {
  return typeof navigator !== 'undefined' && navigator.clipboard !== undefined;
}

export function writeClipboard(text: string): Promise<boolean> {
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
  if (clipboard === undefined) return Promise.resolve(false);
  return clipboard.writeText(text).then(
    () => true,
    () => false,
  );
}

export function copyTextWithFeedback(
  text: string,
  onCopied: () => void,
  onError?: (error: unknown) => void,
): void {
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
  if (clipboard === undefined) {
    onError?.(null);
    return;
  }
  void clipboard.writeText(text).then(onCopied, (error: unknown) => {
    onError?.(error);
  });
}
