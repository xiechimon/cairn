const TILE_COLORS = ['#3f6c35', '#9a6b3a', '#5379a0', '#7a5b8e', '#3d7c7a', '#8a5560'] as const;
const SPIRAL_CREAM = '#f4f6f1';
const TRACE_STYLE =
  '<style>@keyframes trace{from{stroke-dashoffset:1}50%{stroke-dashoffset:0}to{stroke-dashoffset:-1}}.trace{stroke-dasharray:1 1;animation:trace 2.8s cubic-bezier(.65,0,.35,1) infinite}@media (prefers-reduced-motion:reduce){.trace{stroke-dasharray:none;animation:none}}</style>';
const SPIRAL_ARCS = [
  ' A84 84 0 0 1 168 0',
  ' A140 140 0 0 1 -112 0',
  ' A196 196 0 0 1 280 0',
  ' A252 252 0 0 1 -224 0',
];

export function spiralAvatarSvg(seed: string, busy = false): string {
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
  const center = turns === 2 ? '-84 28' : '-28 -28';
  const stroke = `fill="none" stroke="${SPIRAL_CREAM}" stroke-width="64" stroke-linecap="round"`;
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
    (busy ? TRACE_STYLE : '') +
    `<circle cx="50" cy="50" r="50" fill="${color}"/>` +
    `<g transform="translate(50 50) rotate(${rotation}) scale(${0.105 * mirror} 0.105) translate(${center})">` +
    (busy
      ? `<path d="${path}" ${stroke} opacity=".28"/><path class="trace" d="${path}" pathLength="1" ${stroke}/>`
      : `<path d="${path}" ${stroke}/>`) +
    '</g></svg>'
  );
}

export function spiralAvatarUrl(seed: string, busy = false): string {
  return `data:image/svg+xml,${encodeURIComponent(spiralAvatarSvg(seed, busy))}`;
}
