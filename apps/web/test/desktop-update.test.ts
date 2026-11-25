import { toast } from 'sonner';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  desktopUpdateView,
  updateDesktopNow,
  updateInstallRefusalCopy,
} from '../src/board/desktop-update.js';
import { EN } from '../src/i18n/en.js';
import { translate, type TFunc } from '../src/i18n/translate.js';

const zh: TFunc = (key, vars) => translate('zh', EN, key, vars);
const en: TFunc = (key, vars) => translate('en', EN, key, vars);

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { navigator?: unknown }).navigator;
});

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
    expect(viewZh.label).toBe('更新失败，点击重试');
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

  it('maps update install refusals to localized action-oriented copy without raw error noise', () => {
    expect(
      updateInstallRefusalCopy('the staged update is not signed by the Cairn certificate', zh),
    ).toBe('更新包签名验证未通过，无法安装');
    expect(updateInstallRefusalCopy('the staged update is missing', en)).toBe(
      'The downloaded update is no longer available. Check for updates again',
    );
    expect(updateInstallRefusalCopy('Error: EACCES: permission denied', zh)).toBe(
      '未能安装更新，点击重试',
    );
  });

  it('updateDesktopNow surfaces install refusals and non-installable check states via toastError', async () => {
    const errorSpy = vi.spyOn(toast, 'error').mockImplementation(() => '');
    let currentState: { status: string; version?: string } = { status: 'ready', version: '0.43.0' };
    (globalThis as { navigator?: unknown }).navigator = { language: 'zh-CN' };
    (globalThis as { window?: unknown }).window = {
      cairnDesktop: {
        update: {
          state: async () => currentState,
          check: async () => {},
          install: async () => ({
            ok: false,
            reason: 'the staged update is not signed by the Cairn certificate',
          }),
          subscribe: () => () => {},
        },
      },
    };

    await updateDesktopNow();
    expect(errorSpy).toHaveBeenCalledWith('更新包签名验证未通过，无法安装', undefined);

    errorSpy.mockClear();
    currentState = { status: 'offline' };
    await updateDesktopNow();
    expect(errorSpy).toHaveBeenCalledWith('无法连接网络，未能检查更新', undefined);
  });
});
