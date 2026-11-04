import { describe, expect, it } from 'vitest';
import {
  ASCII_RAMP,
  asciiGlyph,
  bayerThreshold,
  driftField,
  luminance,
  sweepField,
  veilAt,
} from '../src/components/texture/texture-core.js';

describe('texture core', () => {
  it('uses each of the sixteen Bayer thresholds once per 4x4 block, strictly inside 0..1', () => {
    const seen = new Set<number>();
    for (let row = 0; row < 4; row += 1)
      for (let col = 0; col < 4; col += 1) seen.add(bayerThreshold(col, row));
    expect(seen.size).toBe(16);
    for (const value of seen) {
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThan(1);
    }
    expect(bayerThreshold(5, 6)).toBe(bayerThreshold(1, 2));
    expect(bayerThreshold(-1, -1)).toBe(bayerThreshold(3, 3));
  });

  it('maps tone to the ASCII ramp from blank to @, clamping out-of-range tones', () => {
    expect(asciiGlyph(0)).toBe(' ');
    expect(asciiGlyph(1)).toBe('@');
    expect(asciiGlyph(-2)).toBe(' ');
    expect(asciiGlyph(7)).toBe('@');
    expect(ASCII_RAMP.indexOf(asciiGlyph(0.5))).toBe(Math.round(0.5 * (ASCII_RAMP.length - 1)));
  });

  it('weights luminance like the eye: green is brightest, blue darkest', () => {
    expect(luminance(255, 255, 255)).toBeCloseTo(1);
    expect(luminance(0, 255, 0)).toBeGreaterThan(luminance(255, 0, 0));
    expect(luminance(255, 0, 0)).toBeGreaterThan(luminance(0, 0, 255));
  });

  it('keeps the drift field inside 0..1 and moves it over time', () => {
    for (let i = 0; i < 200; i += 1) {
      const v = driftField(i * 0.07, i * 0.03, i * 0.11);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(driftField(1, 1, 0)).not.toBeCloseTo(driftField(1, 1, 3));
  });

  it('peaks the loading sweep at its phase and leaves the rest empty', () => {
    expect(sweepField(0.5, 0.5)).toBeCloseTo(0.85);
    expect(sweepField(0, 0.5)).toBe(0);
  });

  it('fades the veil out toward the bottom so headlines stay readable', () => {
    expect(veilAt(0.4)).toBeGreaterThan(veilAt(0.75));
    expect(veilAt(0.95)).toBe(0);
  });
});
