import {
  createDesktopShellDescriptor,
  DESKTOP_BRIDGE_VERSION,
  DESKTOP_SHELL_USER_AGENT,
  MIN_SUPPORTED_BRIDGE_VERSION,
} from '@cairn/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { desktopUpdateSkewView } from '../src/board/desktop-update.js';
import { runnerStep } from '../src/board/setup-prompt.js';
import {
  antigravityBridge,
  antigravityCapabilityState,
  desktopCapabilityState,
  desktopShellDescriptor,
  devinBridge,
  devinCapabilityState,
  isDesktopShell,
  localProviderBridge,
  localRunnerBridge,
  localRunnerCapabilityState,
  ownComputerBridge,
  ownComputerCapabilityState,
} from '../src/desktop-shell.js';
import { EN } from '../src/i18n/en.js';
import { translate, type TFunc } from '../src/i18n/translate.js';

const zh: TFunc = (key, vars) => translate('zh', EN, key, vars);
const en: TFunc = (key, vars) => translate('en', EN, key, vars);

describe('desktop shell descriptor & capability negotiation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds frozen-ready descriptor flags for local and remote modes', () => {
    expect(
      createDesktopShellDescriptor({ shellVersion: '0.1.730', localMode: true, isMac: true }),
    ).toEqual({
      shellVersion: '0.1.730',
      bridgeVersion: DESKTOP_BRIDGE_VERSION,
      capabilities: {
        updateInstall: true,
        remoteServerUpdate: false,
        antigravitySignIn: true,
        hostSwitch: true,
        localProviders: true,
        devinSignIn: true,
        localRunner: true,
        ownComputer: true,
      },
    });
    expect(
      createDesktopShellDescriptor({ shellVersion: '0.1.730', localMode: false, isMac: true })
        .capabilities,
    ).toMatchObject({
      antigravitySignIn: true,
      localRunner: true,
      localProviders: false,
      devinSignIn: false,
      ownComputer: false,
    });
  });

  it('hides desktop-only capabilities and Update Cairn in plain browsers (E9)', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Chrome/156.0 Safari/537.36' });
    expect(isDesktopShell()).toBe(false);
    expect(antigravityCapabilityState()).toBe('hidden');
    expect(devinCapabilityState()).toBe('hidden');
    expect(localRunnerCapabilityState()).toBe('hidden');
    expect(ownComputerCapabilityState()).toBe('hidden');
    expect(antigravityBridge()).toBeNull();
  });

  it('treats desktop UA or cairnDesktop object without methods as needs-update (E1/E2)', () => {
    vi.stubGlobal('window', { cairnDesktop: {} });
    expect(isDesktopShell()).toBe(true);
    expect(antigravityCapabilityState()).toBe('needs-update');
    expect(devinCapabilityState()).toBe('needs-update');
    expect(localRunnerCapabilityState()).toBe('needs-update');
    expect(ownComputerCapabilityState()).toBe('needs-update');
    expect(antigravityBridge()).toBeNull();
    expect(devinBridge()).toBeNull();
    expect(localProviderBridge()).toBeNull();
    expect(localRunnerBridge()).toBeNull();
    expect(ownComputerBridge()).toBeUndefined();

    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', {
      userAgent: `Mozilla/5.0 ${DESKTOP_SHELL_USER_AGENT}`,
    });
    expect(isDesktopShell()).toBe(true);
    expect(antigravityCapabilityState()).toBe('needs-update');
  });

  it('requires signIn on antigravityBridge when transitional shell lacks descriptor (E1/E7)', () => {
    const signIn = vi.fn();
    vi.stubGlobal('window', { cairnDesktop: { antigravity: { status: vi.fn() } } });
    expect(antigravityCapabilityState()).toBe('needs-update');
    expect(antigravityBridge()).toBeNull();

    vi.stubGlobal('window', { cairnDesktop: { antigravity: { signIn } } });
    expect(antigravityCapabilityState()).toBe('allowed');
    expect(antigravityBridge()?.signIn).toBe(signIn);
  });

  it('prompts Update Cairn when shell descriptor bridgeVersion is below floor (E11)', () => {
    const signIn = vi.fn();
    const descriptor = {
      ...createDesktopShellDescriptor({ shellVersion: '0.1.720', localMode: true, isMac: true }),
      bridgeVersion: MIN_SUPPORTED_BRIDGE_VERSION - 1,
    };
    vi.stubGlobal('window', {
      cairnDesktop: {
        shell: descriptor,
        antigravity: { signIn },
        localRunner: { reconnect: vi.fn() },
      },
    });
    expect(antigravityCapabilityState()).toBe('needs-update');
    expect(localRunnerCapabilityState()).toBe('needs-update');
    expect(antigravityBridge()).toBeNull();
  });

  it('hides local-only capabilities in remote mode on a current shell without false Update Cairn', () => {
    const descriptor = createDesktopShellDescriptor({
      shellVersion: '0.1.730',
      localMode: false,
      isMac: true,
    });
    vi.stubGlobal('window', {
      cairnDesktop: {
        shell: descriptor,
        antigravity: { signIn: vi.fn() },
        devin: { login: vi.fn(), status: vi.fn(), import: vi.fn(), cancelLogin: vi.fn() },
        ownComputer: { permissions: vi.fn(), guide: vi.fn() },
      },
    });
    expect(antigravityCapabilityState()).toBe('allowed');
    expect(devinCapabilityState()).toBe('hidden');
    expect(ownComputerCapabilityState()).toBe('hidden');
    expect(desktopCapabilityState('hostSwitch', true)).toBe('allowed');
  });

  it('returns each bridge when shell descriptor allows it', () => {
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
        shell: createDesktopShellDescriptor({ shellVersion: '0.1.730', localMode: true, isMac: true }),
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

describe('desktopUpdateSkewView and i18n cleanup', () => {
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
    expect(en('请下载安装最新版 Cairn。')).toBe('Download and install the latest Cairn.');
  });

  it('removes obsolete browser-fallback strings from i18n', () => {
    expect('在 Cairn 桌面 App 中打开这一页，即可重新登录 Antigravity。' in EN).toBe(false);
    expect('这台电脑无法安装 Antigravity。请在 Mac 上的 Cairn 桌面 App 中重新登录。' in EN).toBe(
      false,
    );
    expect('请在这台 Mac 的 Cairn 桌面应用里完成权限授权与检查。' in EN).toBe(false);
  });

  it('coexists with fullscreen hooks on cairnDesktop.shell', () => {
    const signIn = vi.fn();
    vi.stubGlobal('window', {
      cairnDesktop: {
        shell: { isFullScreen: vi.fn(), onFullScreenChange: vi.fn() },
        antigravity: { signIn },
      },
    });
    expect(desktopShellDescriptor()).toBeNull();
    expect(antigravityCapabilityState()).toBe('allowed');

    const descriptor = createDesktopShellDescriptor({
      shellVersion: '0.1.735',
      localMode: false,
      isMac: true,
    });
    vi.stubGlobal('window', {
      cairnDesktop: {
        shell: {
          ...descriptor,
          isFullScreen: vi.fn(),
          onFullScreenChange: vi.fn(),
        },
        antigravity: { signIn },
      },
    });
    expect(desktopShellDescriptor()).toEqual(descriptor);
    expect(antigravityCapabilityState()).toBe('allowed');
  });
});
