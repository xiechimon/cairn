const BLOCK_MD_LINE = /^(?:#{1,6}\s|```|~~~|[-*+]\s|\d+\.\s|>\s|\|)/m;

export function isNarrationPreamble(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed !== '' &&
    trimmed.length <= 200 &&
    !trimmed.includes('\n\n') &&
    !BLOCK_MD_LINE.test(trimmed)
  );
}
