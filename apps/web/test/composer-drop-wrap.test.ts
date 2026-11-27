import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const tokens = readFileSync(new URL('../src/styles/shadcn.css', import.meta.url), 'utf8');
const themes = {
  dark: tokens.slice(tokens.indexOf(':root {'), tokens.indexOf('\n.light {')),
  light: tokens.slice(tokens.indexOf('\n.light {')),
};

function layers(shadow: string): { x: number; y: number; blur: number }[] {
  return shadow.split(/,(?![^(]*\))/).map((layer) => {
    const [x = 0, y = 0, blur = 0] = layer
      .trim()
      .split(/\s+/)
      .slice(0, 3)
      .map((value) => Number.parseFloat(value));
    return { x, y, blur };
  });
}

for (const [theme, block] of Object.entries(themes)) {
  it(`C-composer: the composer shadow wraps all four sides in ${theme}`, () => {
    const shadow = /--composer-drop:\s*([^;]+);/.exec(block)?.[1];
    expect(shadow, `--composer-drop missing in ${theme}`).toBeDefined();
    const centred = layers(shadow ?? '').filter(
      (layer) => layer.x === 0 && layer.y === 0 && layer.blur >= 6,
    );
    expect(centred, `--composer-drop in ${theme} only falls below the card`).not.toHaveLength(0);
  });
}
