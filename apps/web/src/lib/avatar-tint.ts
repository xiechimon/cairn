const TINTS = ['#3f6c35', '#9a6b3a', '#5379a0', '#7a5b8e', '#3d7c7a', '#8a5560'] as const;
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function avatarTint(seed: string): string {
  let state = 2166136261;
  for (const char of seed) {
    state ^= char.codePointAt(0) ?? 0;
    state = Math.imul(state, 16777619);
  }
  state = state >>> 0 || 1;
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return TINTS[Math.floor(((state >>> 0) / 4294967296) * TINTS.length)] ?? TINTS[0];
}

export function avatarInitial(name: string): string {
  const [first] = graphemes.segment(name.trim());
  return first?.segment.toUpperCase() ?? '';
}
