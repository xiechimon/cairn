const GITHUB_TEXT_MAX = 100;

export function githubText(text: string): string {
  const chars = Array.from(text.replace(/[\p{Cc}\p{Cf}]/gu, ''));
  return chars.length > GITHUB_TEXT_MAX
    ? `${chars.slice(0, GITHUB_TEXT_MAX).join('')}…`
    : chars.join('');
}
