export const BRAND_GLYPH = {
  small: {
    box: 16,
    scale: 0.185,
    offset: [0, -0.324],
    band: 12.5,
    d: 'M-4 0 A4 4 0 0 1 4 0 A19 19 0 0 1 -34 0 A34 34 0 0 1 34 0 A49 49 0 0 1 19.648 34.648',
  },
  large: {
    box: 100,
    scale: 0.66,
    offset: [0, 7.146],
    band: 11.5,
    d: 'M-7 0 A7 7 0 0 1 7 0 A22 22 0 0 1 -37 0 A37 37 0 0 1 37 0 A52 52 0 0 1 -67 0 A67 67 0 0 1 67 0 A82 82 0 0 1 47.816 52.709',
  },
} as const;

export type BrandGlyphSize = keyof typeof BRAND_GLYPH;
