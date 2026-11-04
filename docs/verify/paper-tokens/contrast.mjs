#!/usr/bin/env node
// WCAG 2.x contrast for the light Paper token pairs. usage: node contrast.mjs > contrast.txt
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => {
  const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const mix = (a, b, p) =>
  `#${rgb(a).map((v, i) => Math.round(v * p + rgb(b)[i] * (1 - p)).toString(16).padStart(2, '0')).join('')}`;

const T = {
  canvas: '#f3eee5', background: '#fbf9f5', card: '#ffffff', secondary: '#ebe4d8',
  foreground: '#2b2620', 'text-secondary': '#5e564d', 'text-tertiary': '#746a5f', 'text-dim': '#8f8985',
  'card-button': '#b4532a', 'spot-text-on-tint': '#8a3a1a', 'accent-hover': '#f6ebe3',
  'running': '#5f8f5a', 'running-text': '#4f7049', border: '#ece5da', input: '#cbc5c1', destructive: '#9e2c49',
  white: '#ffffff',
};
T['spot-soft'] = mix(T['card-button'], T.card, 0.14);
T['accent-soft@background'] = mix(T['card-button'], T.background, 0.14);

const rows = [
  ['foreground', 'card', 4.5], ['foreground', 'background', 4.5], ['foreground', 'canvas', 4.5],
  ['text-secondary', 'card', 4.5], ['text-secondary', 'background', 4.5], ['text-secondary', 'canvas', 4.5], ['text-secondary', 'secondary', 4.5],
  ['text-tertiary', 'card', 4.5], ['text-tertiary', 'background', 4.5], ['text-tertiary', 'canvas', 4.5], ['text-tertiary', 'secondary', 4.5],
  ['text-dim', 'card', 3], ['text-dim', 'canvas', 3],
  ['card-button', 'card', 4.5], ['card-button', 'background', 4.5], ['card-button', 'canvas', 3],
  ['white', 'card-button', 4.5], ['background', 'foreground', 4.5],
  ['spot-text-on-tint', 'spot-soft', 4.5], ['spot-text-on-tint', 'accent-soft@background', 4.5], ['spot-text-on-tint', 'accent-hover', 4.5],
  ['card-button', 'spot-soft', 3], ['card-button', 'accent-hover', 4.5],
  ['running', 'card', 3], ['running-text', 'card', 4.5], ['running-text', 'background', 4.5],
  ['destructive', 'card', 4.5],
  ['border', 'card', 1], ['input', 'card', 1],
];
console.log(`spot-soft = ${T['spot-soft']} (card-button 14% over card)`);
console.log(`accent-soft over background = ${T['accent-soft@background']}`);
console.log('pair'.padEnd(52), 'ratio', 'gate', 'result');
for (const [fg, bg, gate] of rows) {
  const r = ratio(T[fg], T[bg]);
  console.log(`${fg} ${T[fg]} on ${bg} ${T[bg]}`.padEnd(52), r.toFixed(2).padStart(5), String(gate).padStart(4), gate === 1 ? 'hairline (no gate)' : r >= gate ? 'pass' : 'FAIL');
}
