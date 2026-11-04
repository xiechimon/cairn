export function planHasOpenDecisions(content: string): boolean {
  const lines = content
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim());
  for (let i = 0; i < lines.length; i++) {
    const name = (lines[i] ?? '')
      .replace(/^#{1,6}\s+/, '')
      .replace(/\s+#+$/, '')
      .replace(/\*\*|__/g, '')
      .replace(/\s*[:：]$/, '')
      .trim();
    if (!/^(open questions|decisions needed|decision points)$/i.test(name)) continue;
    const own = /^(#{1,6})\s/.exec(lines[i] ?? '')?.[1]?.length;
    const level = own ?? (/^=+$/.test(lines[i + 1] ?? '') ? 1 : 2);
    for (const next of lines.slice(i + 1)) {
      if (next === '' || /^(=+|-+)$/.test(next)) continue;
      const nextLevel = /^(#{1,6})\s/.exec(next)?.[1]?.length;
      if (nextLevel !== undefined && nextLevel <= level) break;
      if (/^([-*]\s*)?(none|n\/a|nothing)\.?$/i.test(next)) break;
      return true;
    }
  }
  return false;
}
