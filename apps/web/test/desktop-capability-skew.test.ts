import { afterEach, describe, expect, it, vi } from 'vitest';
import { desktopUpdateSkewView } from '../src/board/desktop-update.js';
import { runnerStep } from '../src/board/setup-prompt.js';
import {
  antigravityBridge,
  devinBridge,
  localProviderBridge,
  localRunnerBridge,
  ownComputerBridge,
} from '../src/desktop-shell.js';
import { EN } from '../src/i18n/en.js';
import { translate, type TFunc } from '../src/i18n/translate.js';

const zh: TFunc = (key, vars) => translate('zh', EN, key, vars);
const en: TFunc = (key, vars) => translate('en', EN, key, vars);

describe('desktop bridge accessors', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns null or undefined when a desktop capability is absent on an older app shell', () => {
    vi.stubGlobal('window', { cairnDesktop: {} });
    expect(antigravityBridge()).toBeNull();
    expect(devinBridge()).toBeNull();
    expect(localProviderBridge()).toBeNull();
    expect(localRunnerBridge()).toBeNull();
    expect(ownComputerBridge()).toBeUndefined();
  });

  it('requires signIn on antigravityBridge so incomplete preloads trigger Update Cairn', () => {
    vi.stubGlobal('window', { cairnDesktop: { antigravity: { status: vi.fn() } } });
    expect(antigravityBridge()).toBeNull();
  });

  it('returns each bridge when exposed', () => {
    const ag = {
      status: vi.fn(),
      import: vi.fn(),
      signIn: vi.fn(),
      cancelLogin: vi.fn(),
      onLoginProgress: vi.fn(),
    };
    const devin = { status: vi.fn(), import: vi.fn(), login: vi.fn(), cancelLogin: vi.fn() };
    const localProviders = { scan: vi.fn(), import: vi.fn() };
    const localRunner = { reconnect: vi.fn() };
    const ownComputer = { guide: vi.fn(), permissions: vi.fn() };
    vi.stubGlobal('window', {
      cairnDesktop: {
        antigravity: ag,
        devin,
        localProviders,
        localRunner,
        ownComputer,
      },
    });
    expect(antigravityBridge()).toBe(ag);
    expect(devinBridge()).toBe(devin);
    expect(localProviderBridge()).toBe(localProviders);
    expect(localRunnerBridge()).toBe(localRunner);
    expect(ownComputerBridge()).toBe(ownComputer);
  });
});

describe('runnerStep without browser fallback', () => {
  it('treats an offline local machine as reconnectable without falling back to cairn start', () => {
    const step = runnerStep(
      [{ name: 'xmonsMac', online: false, kind: 'local' }],
      'cairn start',
      zh,
    );
    expect(step.reconnect).toBe(true);
    expect(step.label).toBe('xmonsMac 离线');
    expect(step.hint).toBe('Cairn 会在这台电脑唤醒后自动重连');
  });

  it('keeps the CLI restart hint when a remote machine is offline', () => {
    const step = runnerStep(
      [{ name: 'build-box', online: false, kind: 'remote' }],
      'cairn start',
      en,
    );
    expect(step.reconnect).toBe(false);
    expect(step.label).toBe('build-box is offline');
  });
});

describe('desktopUpdateSkewView', () => {
  it('shows Update Cairn by default and tracks active desktop update states', () => {
    expect(desktopUpdateSkewView({ status: 'idle' }, zh)).toEqual({
      label: '更新 Cairn',
      busy: false,
      error: null,
    });
    expect(desktopUpdateSkewView({ status: 'idle' }, en)).toEqual({
      label: 'Update Cairn',
      busy: false,
      error: null,
    });
    expect(desktopUpdateSkewView({ status: 'downloading', version: '0.2.0', percent: 42 }, en)).toEqual({
      label: 'Updating 42%',
      busy: true,
      error: null,
    });
    expect(desktopUpdateSkewView({ status: 'error', message: 'network timeout' }, en)).toEqual({
      label: 'Update failed; click to retry',
      busy: false,
      error: 'network timeout',
    });
  });

  it('removes obsolete browser-fallback strings from i18n', () => {
    expect('在 Cairn 桌面 App 中打开这一页，即可重新登录 Antigravity。' in EN).toBe(false);
    expect('这台电脑无法安装 Antigravity。请在 Mac 上的 Cairn 桌面 App 中重新登录。' in EN).toBe(
      false,
    );
    expect('请在这台 Mac 的 Cairn 桌面应用里完成权限授权与检查。' in EN).toBe(false);
  });
});
