const TILE_COLORS = ['#c06a43', '#7d8b5a', '#6b7a8f', '#a0784a', '#8a6a9a', '#4f8a8b'] as const;
const SPIRAL_CREAM = '#f2ead7';
const SPIRAL_ARCS = [
  ' A84 84 0 0 1 168 0',
  ' A140 140 0 0 1 -112 0',
  ' A196 196 0 0 1 280 0',
  ' A252 252 0 0 1 -224 0',
];

export function spiralAvatarSvg(seed: string): string {
  let state = 2166136261;
  for (const char of seed) {
    state ^= char.codePointAt(0) ?? 0;
    state = Math.imul(state, 16777619);
  }
  state = state >>> 0 || 1;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  const color = TILE_COLORS[Math.floor(next() * TILE_COLORS.length)];
  const turns = 2 + Math.floor(next() * 2);
  const rotation = Math.floor(next() * 4) * 90;
  const mirror = next() < 0.5 ? -1 : 1;
  const path = `M0 0${SPIRAL_ARCS.slice(0, turns + 1).join('')}`;
  const centerShift = turns === 2 ? -14 : 28;
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
    `<circle cx="50" cy="50" r="50" fill="${color}"/>` +
    `<g transform="translate(50 50) rotate(${rotation}) scale(${0.105 * mirror} 0.105) translate(-84 ${centerShift})">` +
    `<path d="${path}" fill="none" stroke="${SPIRAL_CREAM}" stroke-width="64" stroke-linecap="round"/>` +
    '</g></svg>'
  );
}

export function spiralAvatarUrl(seed: string): string {
  return `data:image/svg+xml,${encodeURIComponent(spiralAvatarSvg(seed))}`;
}
