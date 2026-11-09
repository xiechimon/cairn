import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { EN } from '../src/i18n/en.js';

const account = readFileSync(new URL('../src/routes/account-page.tsx', import.meta.url), 'utf8');

test('account settings do not mount a feature release manager', () => {
  expect(account).not.toContain('FeatureReleases');
  expect(account).not.toContain('feature-releases');
});

test('feature release copy is removed instead of leaving a hidden feature', () => {
  for (const key of ['新功能发布', '功能标识', '发布新功能', '向所有成员发布 {key}']) {
    expect(EN).not.toHaveProperty(key);
  }
});
