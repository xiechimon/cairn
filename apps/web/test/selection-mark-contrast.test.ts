import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const tokens = readFileSync(new URL('../src/styles/shadcn.css', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8');
const themes = {
  dark: tokens.slice(tokens.indexOf(':root {'), tokens.indexOf('\n.light {')),
  light: tokens.slice(tokens.indexOf('\n.light {')),
};

function hex(name: string, theme: string): string {
  const match = new RegExp(`${name}:\\s*(#[0-9a-f]{6}|var\\((--[a-z-]+)\\))`).exec(theme);
  if (match?.[1] == null) throw new Error(`missing ${name}`);
  return match[2] === undefined ? match[1] : hex(match[2], theme);
}

function channels(color: string): number[] {
  return [1, 3, 5].map((i) => Number.parseInt(color.slice(i, i + 2), 16));
}

function markFill(selector: string): { token: string; share: number } {
  const start = app.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`missing ${selector}`);
  const body = app.slice(start, app.indexOf('}', start));
  const match = /background:\s*color-mix\(in \w+, var\((--[a-z-]+)\) (\d+)%, transparent\)/.exec(
    body,
  );
  if (match?.[1] == null || match[2] == null) throw new Error(`${selector} has no token mix`);
  return { token: match[1], share: Number(match[2]) / 100 };
}

for (const selector of ['::selection', '::highlight(cairn-quote)']) {
  for (const [theme, block] of Object.entries(themes)) {
    for (const fill of ['--reply-bubble-fill', '--bubble-fill']) {
      it(`C40: ${selector} stands out on ${fill} in ${theme}`, () => {
        const { token, share } = markFill(selector);
        const under = channels(hex(fill, block));
        const mark = channels(hex(token, block));
        const painted = under.map((c, i) => Math.round((mark[i] ?? 0) * share + c * (1 - share)));
        const distance = painted.reduce((sum, c, i) => sum + Math.abs(c - (under[i] ?? 0)), 0);
        expect(distance, `${selector} paints ${token} that vanishes on ${fill}`).toBeGreaterThan(
          40,
        );
      });
    }
  }
}
