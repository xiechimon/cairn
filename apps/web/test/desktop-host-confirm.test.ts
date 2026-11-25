import { describe, expect, it } from 'vitest';
import { EN } from '../src/i18n/en.js';
import { translate, type TFunc } from '../src/i18n/translate.js';
import {
  hostRemoveConfirmCopy,
  hostSwitchConfirmCopy,
} from '../src/resources/desktop-host-confirm.js';

const zh: TFunc = (key, vars) => translate('zh', EN, key, vars);
const en: TFunc = (key, vars) => translate('en', EN, key, vars);

describe('desktop host switch and remove confirmation copy', () => {
  it('explains data isolation before switching hosts in both locales', () => {
    const copyZh = hostSwitchConfirmCopy('本机', zh);
    expect(copyZh.title).toContain('本机');
    expect(copyZh.summary).toContain('彼此独立');
    expect(copyZh.summary).toContain('均保留');
    expect(copyZh.confirmLabel).toBe('切换并重启');

    const copyEn = hostSwitchConfirmCopy('This computer', en);
    expect(copyEn.title).toContain('This computer');
    expect(copyEn.summary).toContain('separate');
    expect(copyEn.summary).not.toMatch(/can't|won't|don't|it's/i);
    expect(copyEn.confirmLabel).toBe('Switch and restart');
  });

  it('distinguishes removing the active remote host from an inactive one', () => {
    const activeZh = hostRemoveConfirmCopy('Mac mini', true, zh);
    expect(activeZh.title).toContain('切回本机');
    expect(activeZh.summary).toContain('重启');
    expect(activeZh.confirmLabel).toBe('移除并切回本机');

    const inactiveZh = hostRemoveConfirmCopy('Mac mini', false, zh);
    expect(inactiveZh.title).toContain('Mac mini');
    expect(inactiveZh.summary).not.toContain('重启');
    expect(inactiveZh.confirmLabel).toBe('移除');

    const activeEn = hostRemoveConfirmCopy('Mac mini', true, en);
    expect(activeEn.summary).toContain('restart');
    expect(activeEn.confirmLabel).toBe('Remove and switch back');
  });
});
