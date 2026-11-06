import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const HEAD = process.env.PR_SCREENS_HEAD ?? 'pr-screens-head';

for (const file of readdirSync(HEAD).filter((name) => name.endsWith('.png')).sort()) {
  test(`compare: ${file}`, () => {
    expect(readFileSync(join(HEAD, file))).toMatchSnapshot(file, { maxDiffPixelRatio: 0 });
  });
}
