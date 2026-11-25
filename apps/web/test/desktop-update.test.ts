import { describe, expect, it } from 'vitest';
import { desktopUpdateView } from '../src/board/desktop-update.js';
import { EN } from '../src/i18n/en.js';
import { translate, type TFunc } from '../src/i18n/translate.js';

const zh: TFunc = (key, vars) => translate('zh', EN, key, vars);
const en: TFunc = (key, vars) => translate('en', EN, key, vars);

describe('desktop update button presentation', () => {
  it('treats an offline update check as a network notice with no red failure mark and allows retry', () => {
    const viewZh = desktopUpdateView({ status: 'offline' }, zh);
    expect(viewZh.mark).toBeNull();
    expect(viewZh.busy).toBe(false);
    expect(viewZh.label).toBe('无法连接网络，未能检查更新');
    expect(viewZh.label).not.toContain('更新失败');

    const viewEn = desktopUpdateView({ status: 'offline' }, en);
    expect(viewEn.mark).toBeNull();
    expect(viewEn.busy).toBe(false);
    expect(viewEn.label).toBe('Cannot connect to the network to check for updates');
    expect(viewEn.label).not.toContain('Update failed');
  });

  it('keeps the failed mark and error wording for real update failures', () => {
    const viewZh = desktopUpdateView({ status: 'error', message: '下载中断' }, zh);
    expect(viewZh.mark).toBe('failed');
    expect(viewZh.busy).toBe(false);
    expect(viewZh.label).toBe('更新失败：下载中断');
  });

  it('a downloaded update waits quietly for the user to step away, and a click still updates now', () => {
    const viewZh = desktopUpdateView({ status: 'ready', version: '0.43.0' }, zh);
    expect(viewZh.mark).toBeNull();
    expect(viewZh.busy).toBe(false);
    expect(viewZh.label).toBe('离开时自动更新到 0.43.0');
    expect(desktopUpdateView({ status: 'ready', version: '0.43.0' }, en).label).toBe(
      'Updates to 0.43.0 when you step away',
    );
  });
});
