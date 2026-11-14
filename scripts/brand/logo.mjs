import { encodePng, rasterize } from './raster.mjs';

const r = (n) => Math.round(n * 1000) / 1000;

function spiral({ r0, pitch, halfTurns, tail, band }) {
  const half = pitch / 2;
  const center = (k) => (k % 2 === 0 ? 0 : -half);
  const radius = (k) => r0 + k * half;
  const startAngle = (k) => (k % 2 === 0 ? Math.PI : 0);
  const at = (k, a) => [center(k) + radius(k) * Math.cos(a), radius(k) * Math.sin(a)];
  const pts = [];
  const arcs = [];
  const [sx, sy] = at(0, Math.PI);
  let d = `M${r(sx)} ${r(sy)}`;
  const arc = (k, sweep) => {
    const [x, y] = at(k, startAngle(k) + sweep);
    d += ` A${r(radius(k))} ${r(radius(k))} 0 0 1 ${r(x)} ${r(y)}`;
    arcs.push({ cx: center(k), cy: 0, r: radius(k), from: startAngle(k), sweep });
    for (let i = 0; i <= 32; i++) pts.push(at(k, startAngle(k) + (sweep * i) / 32));
  };
  for (let k = 0; k < halfTurns; k++) arc(k, Math.PI);
  arc(halfTurns, (tail * Math.PI) / 180);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const box = {
    x0: Math.min(...xs) - band / 2,
    x1: Math.max(...xs) + band / 2,
    y0: Math.min(...ys) - band / 2,
    y1: Math.max(...ys) + band / 2,
  };
  return { d, band, box, arcs };
}

export const LARGE = spiral({ r0: 7, pitch: 30, halfTurns: 5, tail: 40, band: 11.5 });
export const SMALL = spiral({ r0: 4, pitch: 30, halfTurns: 3, tail: 45, band: 12.5 });
export const SMALL_BELOW_PX = 48;

export const PLATE = {
  dark: { fill: '#151615', ink: '#cfd0cb' },
  light: { fill: '#ecebe6', ink: '#202220' },
};

function placement(mark, span, cx, cy) {
  const w = mark.box.x1 - mark.box.x0;
  const h = mark.box.y1 - mark.box.y0;
  return {
    cx,
    cy,
    k: r(span / Math.max(w, h)),
    mx: -r(-(mark.box.x0 + mark.box.x1) / 2),
    my: -r(-(mark.box.y0 + mark.box.y1) / 2),
  };
}

function placed(mark, at, stroke) {
  return `<g transform="translate(${r(at.cx)} ${r(at.cy)}) scale(${at.k}) translate(${-at.mx} ${-at.my})"><path d="${mark.d}" fill="none" ${stroke} stroke-width="${r(mark.band)}" stroke-linecap="round"/></g>`;
}

const svg = (w, h, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>\n`;

function scene({ size, inset = 0, rx, scheme, mark, ratio }) {
  const body = size - 2 * inset;
  return {
    size,
    plate: { inset, rx, fill: PLATE[scheme].fill },
    ink: PLATE[scheme].ink,
    mark,
    at: placement(mark, ratio * body, size / 2, size / 2),
  };
}

const FAVICON = { size: 16, rx: 3.5, ratio: 12.4 / 16 };
const ICON = { size: 1024, rx: 225, ratio: 600 / 1024 };
const TOUCH = { size: 1024, rx: 0, ratio: 600 / 1024 };
const MASKABLE = { size: 512, rx: 0, ratio: 270 / 512 };

const markFor = (px) => (px < SMALL_BELOW_PX ? SMALL : LARGE);
const png = (spec, scheme, px) =>
  encodePng(rasterize(scene({ ...spec, scheme, mark: markFor(px) }), px));

function faviconSvg() {
  const at = scene({ ...FAVICON, scheme: 'light', mark: SMALL }).at;
  return svg(
    16,
    16,
    `<style>.p{fill:${PLATE.light.fill}}.i{stroke:${PLATE.light.ink}}@media (prefers-color-scheme:dark){.p{fill:${PLATE.dark.fill}}.i{stroke:${PLATE.dark.ink}}}</style>` +
      `<rect class="p" width="16" height="16" rx="${FAVICON.rx}"/>` +
      placed(SMALL, at, 'class="i"'),
  );
}

function glyph(mark, box, span) {
  const at = placement(mark, span, box / 2, box / 2);
  return { box, scale: at.k, offset: [-at.mx, -at.my], band: r(mark.band), d: mark.d, at };
}

export const GLYPHS = { small: glyph(SMALL, 16, 15), large: glyph(LARGE, 100, 96) };

function brandMarkModule() {
  const entry = (name, g) =>
    `  ${name}: {\n    box: ${g.box},\n    scale: ${g.scale},\n    offset: [${g.offset[0]}, ${g.offset[1]}],\n    band: ${g.band},\n    d: '${g.d}',\n  },\n`;
  return `export const BRAND_GLYPH = {\n${entry('small', GLYPHS.small)}${entry('large', GLYPHS.large)}} as const;\n\nexport type BrandGlyphSize = keyof typeof BRAND_GLYPH;\n`;
}

export const APP_ICON = 'apps/ios/Cairn/AppIcon.icon';

const APP_ICON_SPAN = 640;
const APP_ICON_GRADIENT = {
  light: ['#202220', '#737570'],
  dark: ['#f2f2ed', '#8c8f8a'],
};

function bandOutline(mark) {
  const h = mark.band / 2;
  const segments = mark.arcs.flatMap((arc) => {
    const parts = arc.sweep > Math.PI / 2 ? 2 : 1;
    return Array.from({ length: parts }, (_, i) => ({
      ...arc,
      from: arc.from + (arc.sweep * i) / parts,
      sweep: arc.sweep / parts,
    }));
  });
  const at = (s, radius, angle) =>
    `${r(s.cx + radius * Math.cos(angle))} ${r(s.cy + radius * Math.sin(angle))}`;
  const first = segments[0];
  const last = segments[segments.length - 1];
  let d = `M${at(first, first.r + h, first.from)}`;
  for (const s of segments)
    d += ` A${r(s.r + h)} ${r(s.r + h)} 0 0 1 ${at(s, s.r + h, s.from + s.sweep)}`;
  d += ` A${r(h)} ${r(h)} 0 0 1 ${at(last, last.r - h, last.from + last.sweep)}`;
  for (const s of [...segments].reverse())
    d += ` A${r(s.r - h)} ${r(s.r - h)} 0 0 0 ${at(s, s.r - h, s.from)}`;
  return `${d} A${r(h)} ${r(h)} 0 0 1 ${at(first, first.r + h, first.from)}Z`;
}

function appIconLayer() {
  const at = placement(LARGE, APP_ICON_SPAN, 512, 512);
  return svg(
    1024,
    1024,
    `<g transform="translate(${at.cx} ${at.cy}) scale(${at.k}) translate(${-at.mx} ${-at.my})"><path d="${bandOutline(LARGE)}" fill="${PLATE.light.ink}"/></g>`,
  );
}

const srgb = (hex) =>
  `extended-srgb:${[1, 3, 5].map((i) => (Number.parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(5)).join(',')},1.00000`;

function appIconJson() {
  const byScheme = (value) => [
    { value: value('light') },
    { appearance: 'dark', value: value('dark') },
  ];
  const icon = {
    'fill-specializations': byScheme((scheme) => ({ solid: srgb(PLATE[scheme].fill) })),
    groups: [
      {
        name: 'Spiral',
        layers: [
          {
            name: 'spiral',
            'image-name': 'spiral.svg',
            glass: true,
            'fill-specializations': byScheme((scheme) => ({
              'linear-gradient': APP_ICON_GRADIENT[scheme].map(srgb),
              orientation: { start: { x: 0.3, y: 0.2 }, stop: { x: 0.8, y: 0.9 } },
            })),
          },
        ],
        specular: true,
        shadow: { kind: 'neutral', opacity: 0.4 },
        translucency: { enabled: false, value: 0 },
      },
    ],
    'supported-platforms': { squares: 'shared' },
  };
  return `${JSON.stringify(icon, null, 2)}\n`;
}

export const ICNS_SLOTS = [
  ['icp4', 16],
  ['ic11', 32],
  ['icp5', 32],
  ['ic12', 64],
  ['ic07', 128],
  ['ic13', 256],
  ['ic08', 256],
  ['ic14', 512],
  ['ic09', 512],
  ['ic10', 1024],
];

export function brandFiles() {
  const favicon = faviconSvg();
  const files = [
    ['apps/web/public/logo.svg', favicon],
    ['site/logo.svg', favicon],
    [
      'apps/web/public/logo-mark.svg',
      svg(100, 100, placed(LARGE, GLYPHS.large.at, 'stroke="currentColor"')),
    ],
    ['apps/web/src/lib/brand-mark.ts', brandMarkModule()],
  ];
  for (const px of [192, 512]) {
    files.push([`apps/web/public/icon-${px}.png`, png(ICON, 'dark', px)]);
    files.push([`apps/web/public/icon-maskable-${px}.png`, png(MASKABLE, 'dark', px)]);
  }
  for (const scheme of ['dark', 'light'])
    files.push([`apps/web/public/icon-192-${scheme}.png`, png(TOUCH, scheme, 192)]);
  files.push([`${APP_ICON}/icon.json`, appIconJson()]);
  files.push([`${APP_ICON}/Assets/spiral.svg`, appIconLayer()]);
  return files;
}
