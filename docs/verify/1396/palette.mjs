#!/usr/bin/env node
// Dark Paper palette for #1396: every slot is defined in OKLCH (one hue
// across the neutral ladder, lightness per role), converted to sRGB hex, and
// every text / non-text pair is measured with WCAG 2.x relative luminance.
// usage: node docs/verify/1396/palette.mjs [--css] > docs/verify/1396/contrast.txt
// Exit 1 when a gated pair fails.

const clamp = (v) => Math.min(1, Math.max(0, v));
const gamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function oklchToRgb(L, C, H) {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const inGamut = [r, g, bb].every((v) => v >= -0.0005 && v <= 1.0005);
  const hex = `#${[r, g, bb]
    .map((v) => Math.round(clamp(gamma(clamp(v))) * 255).toString(16).padStart(2, '0'))
    .join('')}`;
  return { hex, inGamut };
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = ([r, g, b]) => 0.2126 * toLin(r / 255) + 0.7152 * toLin(g / 255) + 0.0722 * toLin(b / 255);
const ratio = (fg, bg) => {
  const [hi, lo] = [lum(rgb(fg)), lum(rgb(bg))].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
};
// color-mix(in srgb, a p%, b): gamma-encoded channel interpolation.
const mix = (a, b, p) =>
  `#${rgb(a)
    .map((v, i) => Math.round(v * p + rgb(b)[i] * (1 - p)).toString(16).padStart(2, '0'))
    .join('')}`;
// Alpha black over an opaque colour (the dialog dim over the page).
const dim = (hex, alpha) =>
  `#${rgb(hex)
    .map((v) => Math.round(v * (1 - alpha)).toString(16).padStart(2, '0'))
    .join('')}`;

// ---- the palette (L, C, H) ----
// Neutral ladder: hue 70 (warm brown-grey, the dark side of the cream paper),
// chroma 0.011 on surfaces, 0.010 on text. Elevation = lighter.
const NEUTRAL_H = 70;
const DEF = {
  canvas: [0.205, 0.011, NEUTRAL_H],
  background: [0.245, 0.011, NEUTRAL_H],
  card: [0.29, 0.011, NEUTRAL_H],
  popover: [0.32, 0.011, NEUTRAL_H],
  secondary: [0.34, 0.011, NEUTRAL_H],
  'menu-hover': [0.355, 0.011, NEUTRAL_H],
  border: [0.35, 0.011, NEUTRAL_H],
  input: [0.42, 0.011, NEUTRAL_H],
  'surface-tertiary': [0.38, 0.011, NEUTRAL_H],
  ring: [0.6, 0.008, NEUTRAL_H],
  foreground: [0.93, 0.012, 80],
  'text-secondary': [0.81, 0.011, 78],
  'text-tertiary': [0.73, 0.011, 76],
  'text-dim': [0.565, 0.011, 74],
  icon: [0.64, 0.011, 75],
  // one accent: terracotta, the light #b4532a lifted to L .75 for dark text
  'card-button': [0.75, 0.125, 42],
  'spot-text-on-tint': [0.86, 0.075, 48],
  // running green, the light #5f8f5a / #4f7049 / #7ea476 lifted
  running: [0.73, 0.1, 145],
  'running-text': [0.8, 0.09, 145],
  'running-bar': [0.68, 0.1, 145],
  'running-track': [0.35, 0.011, NEUTRAL_H],
  'online-ring': [0.33, 0.04, 145],
  // six project tiles, same six hues as the light set, dark letter on each
  'project-tile-1': [0.72, 0.1, 42],
  'project-tile-2': [0.72, 0.075, 120],
  'project-tile-3': [0.72, 0.055, 250],
  'project-tile-4': [0.74, 0.085, 72],
  'project-tile-5': [0.72, 0.065, 310],
  'project-tile-6': [0.72, 0.07, 195],
};

const T = {};
const gamut = [];
for (const [name, [L, C, H]] of Object.entries(DEF)) {
  const { hex, inGamut } = oklchToRgb(L, C, H);
  T[name] = hex;
  if (!inGamut) gamut.push(name);
}
T['accent-hover'] = mix(T['card-button'], T.card, 0.12);
T['spot-soft'] = mix(T['card-button'], T.card, 0.14);
T['accent-soft@background'] = mix(T['card-button'], T.background, 0.14);
T['text-on-accent'] = T.canvas;
T['primary'] = T.foreground;
T['primary-foreground'] = T.background;
T.destructive = '#ffabb7';
T.white = '#ffffff';
T['card-hover'] = mix(T.foreground, T.card, 0.08);
T['sidebar-hover@canvas'] = mix('#fffcf8', T.canvas, 0.05);
T['sidebar-active@canvas'] = mix('#fffcf8', T.canvas, 0.1);
T['dialog-backdrop@background'] = dim(T.background, 0.45);
T['dialog-backdrop@card'] = dim(T.card, 0.45);

const rows = [
  // ink ladder on the three papers
  ['foreground', 'card', 4.5], ['foreground', 'background', 4.5], ['foreground', 'canvas', 4.5], ['foreground', 'popover', 4.5],
  ['text-secondary', 'card', 4.5], ['text-secondary', 'background', 4.5], ['text-secondary', 'canvas', 4.5], ['text-secondary', 'secondary', 4.5], ['text-secondary', 'popover', 4.5],
  ['text-tertiary', 'card', 4.5], ['text-tertiary', 'background', 4.5], ['text-tertiary', 'canvas', 4.5], ['text-tertiary', 'popover', 4.5], ['text-tertiary', 'secondary', 4.5], ['text-tertiary', 'menu-hover', 4.5],
  ['text-dim', 'card', 3], ['text-dim', 'canvas', 3],
  ['icon', 'card', 3], ['icon', 'canvas', 3], ['icon', 'background', 3],
  // accent as link text, icon and focus ring
  ['card-button', 'card', 4.5], ['card-button', 'background', 4.5], ['card-button', 'canvas', 4.5], ['card-button', 'popover', 4.5],
  ['text-on-accent', 'card-button', 4.5], ['white', 'card-button', 4.5, 'rejected'],
  ['spot-text-on-tint', 'spot-soft', 4.5], ['spot-text-on-tint', 'accent-soft@background', 4.5], ['spot-text-on-tint', 'accent-hover', 4.5],
  ['card-button', 'spot-soft', 3], ['card-button', 'accent-hover', 4.5],
  // primary (ink) button
  ['primary-foreground', 'primary', 4.5],
  // running
  ['running', 'card', 3], ['running', 'canvas', 3], ['running-text', 'card', 4.5], ['running-text', 'background', 4.5], ['running-text', 'canvas', 4.5], ['running-bar', 'running-track', 3],
  // tiles carry the dark letter
  ['text-on-accent', 'project-tile-1', 4.5], ['text-on-accent', 'project-tile-2', 4.5], ['text-on-accent', 'project-tile-3', 4.5], ['text-on-accent', 'project-tile-4', 4.5], ['text-on-accent', 'project-tile-5', 4.5], ['text-on-accent', 'project-tile-6', 4.5],
  // danger
  ['destructive', 'card', 4.5], ['destructive', 'popover', 4.5],
  // hover / dim surfaces keep the ink readable
  ['foreground', 'card-hover', 4.5], ['text-tertiary', 'card-hover', 4.5],
  ['foreground', 'sidebar-hover@canvas', 4.5], ['text-secondary', 'sidebar-hover@canvas', 4.5], ['text-tertiary', 'sidebar-active@canvas', 4.5],
  // hairlines and layer steps (reported, no gate)
  ['border', 'card', 1], ['border', 'background', 1], ['border', 'canvas', 1], ['input', 'card', 1],
  ['canvas', 'background', 1], ['background', 'card', 1], ['card', 'popover', 1], ['popover', 'menu-hover', 1], ['card', 'secondary', 1], ['card', 'accent-hover', 1],
  ['popover', 'dialog-backdrop@background', 1], ['popover', 'dialog-backdrop@card', 1],
];

if (process.argv.includes('--css')) {
  for (const [name, hex] of Object.entries(T)) console.log(`  --${name}: ${hex};`);
  process.exit(0);
}

console.log('dark Paper palette (#1396), OKLCH -> sRGB, WCAG 2.x relative luminance');
for (const [name, [L, C, H]] of Object.entries(DEF)) {
  console.log(`  ${name.padEnd(18)} oklch(${L} ${C} ${H})`.padEnd(48), T[name]);
}
console.log(`  accent-hover       card-button 12% over card`.padEnd(48), T['accent-hover']);
console.log(`  spot-soft          card-button 14% over card`.padEnd(48), T['spot-soft']);
console.log(`  text-on-accent     = canvas`.padEnd(48), T['text-on-accent']);
console.log(`  card-hover         foreground 8% over card`.padEnd(48), T['card-hover']);
console.log(`  sidebar-hover      #fffcf8 5% over canvas`.padEnd(48), T['sidebar-hover@canvas']);
console.log(`  dialog-backdrop    black 45% over background`.padEnd(48), T['dialog-backdrop@background']);
if (gamut.length) console.log('out of sRGB gamut (clamped):', gamut.join(', '));
console.log('');
console.log('pair'.padEnd(66), 'ratio', 'gate', 'result');
let failed = 0;
for (const [fg, bg, gate, note] of rows) {
  const r = ratio(T[fg], T[bg]);
  const ok = r >= gate;
  if (gate > 1 && !ok && !note) failed += 1;
  console.log(
    `${fg} ${T[fg]} on ${bg} ${T[bg]}`.padEnd(66),
    r.toFixed(2).padStart(5),
    String(gate).padStart(4),
    gate === 1 ? 'step (no gate)' : ok ? 'pass' : note ? `FAIL (${note} option)` : 'FAIL',
  );
}
console.log('');
console.log(failed ? `${failed} gated pair(s) FAIL` : 'all gated pairs pass');
process.exit(failed ? 1 : 0);
