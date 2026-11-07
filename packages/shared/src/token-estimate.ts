export function estimateTokens(text: string): number {
  let total = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    total += code < 128 ? 0.3 : code < 0x0590 ? 0.6 : 1.25;
  }
  return Math.ceil(total);
}
