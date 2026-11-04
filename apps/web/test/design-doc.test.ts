import { describe, expect, it } from 'vitest';
import { docChecks, parseFrontmatter } from '../src/design/design-doc.js';

const DOC = `---
name: Cairn
colors:
  canvas: '#efe6d0'        # app background
  hover: 'rgb(255 252 248 / 0.05)'  # translucent
  online-ring: '#dfe9da'
  project-tiles: ['#c06a43', '#7d8b5a']
colors-dark:
  canvas: '#1a1612'
rounded:
  card: 20px         # --radius-card
  full: 9999px
spacing:
  card-padding: 12px 14px
---

## Body

canvas: '#000000'
`;

describe('parseFrontmatter', () => {
  it('keeps a hex value whole when a comment follows it', () => {
    expect(parseFrontmatter(DOC).colors?.canvas).toBe('#efe6d0');
  });

  it('reads translucent colors, arrays and unquoted values', () => {
    const doc = parseFrontmatter(DOC);
    expect(doc.colors?.hover).toBe('rgb(255 252 248 / 0.05)');
    expect(doc.colors?.['project-tiles']).toEqual(['#c06a43', '#7d8b5a']);
    expect(doc.rounded?.card).toBe('20px');
    expect(doc.spacing?.['card-padding']).toBe('12px 14px');
  });

  it('ignores lines after the closing fence', () => {
    expect(parseFrontmatter(DOC)['colors-dark']?.canvas).toBe('#1a1612');
  });

  it('reads double-quoted values and arrays', () => {
    const doc = parseFrontmatter(`---\ncolors:\n  ink: "#2b2620"\n  project-tiles: ["#c06a43"]\n---\n`);
    expect(doc.colors?.ink).toBe('#2b2620');
    expect(doc.colors?.['project-tiles']).toEqual(['#c06a43']);
  });

  it('reads a file saved with CRLF line endings', () => {
    const doc = parseFrontmatter('---\r\ncolors:\r\n  canvas: \'#efe6d0\'\r\n---\r\n');
    expect(doc.colors?.canvas).toBe('#efe6d0');
  });
});

describe('docChecks', () => {
  it('maps theme colors, project tiles and radii to CSS expressions', () => {
    const { checks, unmapped } = docChecks(parseFrontmatter(DOC), 'light');
    expect(checks).toContainEqual({
      key: 'canvas',
      expected: '#efe6d0',
      cssExpr: 'var(--canvas)',
      kind: 'color',
    });
    expect(checks).toContainEqual({
      key: 'project-tiles-2',
      expected: '#7d8b5a',
      cssExpr: 'var(--project-tile-2)',
      kind: 'color',
    });
    expect(checks).toContainEqual({
      key: 'rounded.card',
      expected: '20px',
      cssExpr: 'var(--radius-card)',
      kind: 'length',
    });
    expect(unmapped).toEqual(['online-ring']);
  });

  it('treats only project-tiles as tile slots and reports other arrays as unmapped', () => {
    const doc = parseFrontmatter(`---\ncolors:\n  chart-colors: ['#111111', '#222222']\n---\n`);
    const { checks, unmapped } = docChecks(doc, 'light');
    expect(checks).toEqual([]);
    expect(unmapped).toEqual(['chart-colors']);
  });

  it('reads the dark block for the dark theme and skips radii with no token', () => {
    const { checks } = docChecks(parseFrontmatter(DOC), 'dark');
    expect(checks.find((c) => c.key === 'canvas')?.expected).toBe('#1a1612');
    expect(checks.some((c) => c.key === 'rounded.full')).toBe(false);
  });
});
