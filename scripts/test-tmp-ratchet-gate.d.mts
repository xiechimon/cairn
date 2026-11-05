export function countRawAllocations(source: string): number;
export function compareToBaseline(
  current: Record<string, number>,
  baseline: Record<string, number>,
): { file: string; count: number; allowed: number }[];
export function shrunk(
  current: Record<string, number>,
  baseline: Record<string, number>,
): Record<string, number>;
export function scan(root?: string): Record<string, number>;
