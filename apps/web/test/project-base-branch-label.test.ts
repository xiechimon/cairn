import { expect, test } from 'vitest';
import { EN } from '../src/i18n/en.js';
import { translate } from '../src/i18n/translate.js';

test('the default branch label is translated with the branch name intact', () => {
  expect(translate('zh', EN, '{branch}（默认）', { branch: 'main' })).toBe('main（默认）');
  expect(translate('en', EN, '{branch}（默认）', { branch: 'main' })).toBe('main (default)');
});
