import { type CSSProperties, useRef } from 'react';

const FRESH_MS = 1500;
const MAX_CHAR_STEP = 40;

const madeHere = new Set<string>();

export function noteCreatedHere(id: string): void {
  madeHere.add(id);
}

export const createdHere = (id: string): boolean => madeHere.has(id);

export function useArrivals(ids: readonly string[], ready = true): ReadonlySet<string> {
  const known = useRef<Set<string> | null>(null);
  const arrived = useRef(new Map<string, number>());
  if (known.current === null) {
    if (!ready) return new Set();
    known.current = new Set(ids);
  }
  const now = Date.now();
  for (const id of ids)
    if (!known.current.has(id) && !arrived.current.has(id)) arrived.current.set(id, now);
  return new Set(ids.filter((id) => now - (arrived.current.get(id) ?? -Infinity) < FRESH_MS));
}

export function GrowText({ text }: { text: string }) {
  return Array.from(text, (char, n) => (
    <span
      key={n}
      className="grow-char"
      style={{ '--char': Math.min(n, MAX_CHAR_STEP) } as CSSProperties}
    >
      {char}
    </span>
  ));
}
