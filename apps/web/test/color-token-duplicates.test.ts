import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const css = readFileSync(new URL('../src/styles/shadcn.css', import.meta.url), 'utf8');

const DISTINCT_ROLES_SHARING_A_VALUE = [
  [
    '--accent-foreground',
    '--card-foreground',
    '--foreground',
    '--popover-foreground',
    '--secondary-foreground',
  ],
  ['--accent', '--muted', '--secondary'],
  ['--muted-foreground', '--text-secondary'],
  ['--ring', '--running-text'],
  ['--running-track', '--surface-tertiary'],
  ['--icon', '--text-tertiary'],
  ['--switch-thumb', '--text-on-veil'],
  ['--running-bar', '--switch-on'],
].map((group) => group.join(' '));

function hexTokens(block: string): Map<string, string> {
  return new Map(
    [...block.matchAll(/^\s*(--[a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gm)].map((m) => [
      m[1] ?? '',
      m[2] ?? '',
    ]),
  );
}

test('a hex pair repeated across both themes is a listed role split, otherwise an alias', () => {
  const dark = hexTokens(css.slice(css.indexOf(':root {'), css.indexOf('\n.light {')));
  const light = hexTokens(css.slice(css.indexOf('\n.light {')));
  const groups = new Map<string, string[]>();
  for (const [name, lightHex] of light) {
    const darkHex = dark.get(name);
    if (darkHex == null) continue;
    const key = `${lightHex} ${darkHex}`;
    groups.set(key, [...(groups.get(key) ?? []), name]);
  }
  const repeated = [...groups.values()]
    .filter((names) => names.length > 1)
    .map((names) => names.sort().join(' '))
    .sort();
  expect(repeated).toEqual([...DISTINCT_ROLES_SHARING_A_VALUE].sort());
});
