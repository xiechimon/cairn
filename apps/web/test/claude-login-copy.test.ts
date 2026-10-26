import { describe, expect, test } from 'vitest';
import { EN } from '../src/i18n/en.js';
import { translate } from '../src/i18n/translate.js';

const DAYS =
  '{name} 上的 Claude Code 登录将在 {days} 天后过期。在该机器上运行 `claude auth login` 重新登录。';
const ONE_DAY =
  '{name} 上的 Claude Code 登录将在 1 天后过期。在该机器上运行 `claude auth login` 重新登录。';
const SOON =
  '{name} 上的 Claude Code 登录将在不到 1 天内过期。在该机器上运行 `claude auth login` 重新登录。';
const EXPIRED =
  '{name} 上的 Claude Code 登录已过期。在该机器上运行 `claude auth login` 重新登录。';

describe('Claude Code login warning copy', () => {
  test('two days left names the machine and the re-login command', () => {
    expect(translate('en', EN, DAYS, { name: 'omarchy', days: 2 })).toBe(
      'Claude Code login on omarchy expires in 2 days. On that machine run `claude auth login`.',
    );
  });

  test('one day uses the singular', () => {
    expect(translate('en', EN, ONE_DAY, { name: 'omarchy' })).toBe(
      'Claude Code login on omarchy expires in 1 day. On that machine run `claude auth login`.',
    );
  });

  test('under a day and expiry each name the machine and the command', () => {
    expect(translate('en', EN, SOON, { name: 'omarchy' })).toBe(
      'Claude Code login on omarchy expires in less than a day. On that machine run `claude auth login`.',
    );
    expect(translate('en', EN, EXPIRED, { name: 'ghost' })).toBe(
      'Claude Code login on ghost has expired. On that machine run `claude auth login`.',
    );
  });
});
