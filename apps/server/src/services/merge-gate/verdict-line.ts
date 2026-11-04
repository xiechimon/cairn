const VERDICT_LINE = /^\s*VERDICT:\s*(pass|block)\s*$/i;

export type FinalVerdictLine = 'pass' | 'block';

export function parseFinalVerdictLine(text: string): FinalVerdictLine | null {
  let found: FinalVerdictLine | null = null;
  for (const line of text.split(/\r?\n/)) {
    const match = VERDICT_LINE.exec(line);
    if (match?.[1] === undefined) continue;
    found = match[1].toLowerCase() as FinalVerdictLine;
  }
  return found;
}
