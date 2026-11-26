function asyncClipboard(): Clipboard | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator.clipboard;
}

function copyThroughCopyEvent(text: string): boolean {
  if (typeof document === 'undefined') return false;
  let filled = false;
  const fill = (event: ClipboardEvent) => {
    if (event.clipboardData === null) return;
    event.clipboardData.setData('text/plain', text);
    event.preventDefault();
    event.stopImmediatePropagation();
    filled = true;
  };
  document.addEventListener('copy', fill, true);
  const accepted = document.execCommand('copy');
  document.removeEventListener('copy', fill, true);
  return accepted && filled;
}

export function writeClipboard(text: string): Promise<boolean> {
  const clipboard = asyncClipboard();
  if (clipboard === undefined) return Promise.resolve(copyThroughCopyEvent(text));
  return clipboard.writeText(text).then(
    () => true,
    () => false,
  );
}

export function copyTextWithFeedback(
  text: string,
  onCopied: () => void,
  onError: (error: unknown) => void,
): void {
  const clipboard = asyncClipboard();
  if (clipboard === undefined) {
    if (copyThroughCopyEvent(text)) onCopied();
    else onError(null);
    return;
  }
  void clipboard.writeText(text).then(onCopied, onError);
}
