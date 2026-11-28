import { type ChildProcess, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  DOUBAO_QR_MAX_BYTES,
  type DoubaoLoginReason,
  type DoubaoReport,
  type MachineDoubaoLoginEventBody,
  sleep,
} from '@cairn/shared';
import { doubaoInstallSupported } from '@cairn/shared/doubao-install';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60_000;
const LOGOUT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRY_DELAYS_MS = [200, 600] as const;

export interface DoubaoLoginRunnerOptions {
  platform?: NodeJS.Platform;
  arch?: string;
  env?: NodeJS.ProcessEnv;
  ensureBinary: (signal?: AbortSignal) => Promise<{ command: string } | null>;
  refreshProbe: () => Promise<DoubaoReport>;
  onLogoutStart?: () => void;
  onEvent: (event: MachineDoubaoLoginEventBody) => Promise<void> | void;
  onEmitError?: (error: unknown, event: MachineDoubaoLoginEventBody) => void;
  loginTimeoutMs?: number;
  logoutTimeoutMs?: number;
  retryDelaysMs?: readonly number[];
}

export interface DoubaoLoginRunner {
  start(loginId: string, opts?: { logoutFirst?: boolean }): Promise<void>;
  cancel(loginId?: string): void;
  shutdown(): void;
  activeLoginId(): string | null;
}

export function isValidPngBuffer(buf: Buffer): boolean {
  return (
    buf.byteLength >= PNG_MAGIC.byteLength &&
    buf.byteLength <= DOUBAO_QR_MAX_BYTES &&
    buf.subarray(0, 8).equals(PNG_MAGIC)
  );
}

export function classifyDoubaoLoginFailure(
  text: string,
  timedOut: boolean,
): { status: 'expired' | 'refused' | 'failed'; reason: DoubaoLoginReason; detail?: string } {
  if (timedOut) {
    return {
      status: 'expired',
      reason: 'expired',
      detail: '登录二维码已过期，请刷新后重新扫码。',
    };
  }
  if (/keychain|os_status|seckeychain|user interaction is not allowed|钥匙串/i.test(text)) {
    return {
      status: 'failed',
      reason: 'keychain_locked',
      detail: '本机钥匙串已锁定或不可访问，请在这台电脑解锁登录钥匙串后重试。',
    };
  }
  if (/过期|超时|expired|timed_out/i.test(text)) {
    return {
      status: 'expired',
      reason: 'expired',
      detail: '登录二维码已过期，请刷新后重新扫码。',
    };
  }
  if (/拒绝|refused/i.test(text)) {
    return {
      status: 'refused',
      reason: 'refused',
      detail: '已在手机上取消本次登录。',
    };
  }
  if (/额外验证|unsupported|enterprise_required|risk_restricted|restricted|suspended/i.test(text)) {
    return {
      status: 'failed',
      reason: 'unsupported_account',
      detail: '当前账号受限或需要额外验证，暂不支持用于 CLI 登录，请更换账号重试。',
    };
  }
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const tail = lines[lines.length - 1]?.slice(0, 300);
  return {
    status: 'failed',
    reason: 'unknown',
    ...(tail !== undefined ? { detail: tail } : {}),
  };
}

function isPermanentHttpError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const status = (error as { status?: unknown }).status;
  return status === 400 || status === 401 || status === 403 || status === 404;
}

function spawnLogout(
  command: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): { child: ChildProcess; done: Promise<{ ok: boolean; detail?: string }> } {
  const child = spawn(command, ['logout'], { stdio: ['ignore', 'pipe', 'pipe'], env });
  const done = new Promise<{ ok: boolean; detail?: string }>((resolve) => {
    let settled = false;
    let output = '';
    const append = (chunk: Buffer | string) => {
      if (output.length < 1000) output += chunk.toString();
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      resolve({ ok: false, detail: '退出当前豆包账号超时，请重试。' });
    }, timeoutMs);
    timer.unref();
    const finish = (res: { ok: boolean; detail?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(res);
    };
    child.once('error', (err) => finish({ ok: false, detail: err.message.slice(0, 300) }));
    child.once('exit', (code) => {
      if (code === 0) {
        finish({ ok: true });
      } else {
        const tail = output
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
          .at(-1)
          ?.slice(0, 300);
        finish({ ok: false, detail: tail ?? `退出当前豆包账号失败（exit ${code ?? 'null'}）。` });
      }
    });
  });
  return { child, done };
}

export function createDoubaoLoginRunner(opts: DoubaoLoginRunnerOptions): DoubaoLoginRunner {
  const platform = opts.platform ?? process.platform;
  const arch = opts.arch ?? process.arch;
  const baseEnv = opts.env ?? process.env;
  const loginTimeoutMs = opts.loginTimeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS;
  const logoutTimeoutMs = opts.logoutTimeoutMs ?? LOGOUT_TIMEOUT_MS;
  const retryDelaysMs = opts.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;

  let active: {
    loginId: string;
    revision: number;
    cancelled: boolean;
    settled: boolean;
    timedOut: boolean;
    abortController: AbortController;
    child: ChildProcess | null;
    timer: ReturnType<typeof setTimeout> | null;
    killTimer: ReturnType<typeof setTimeout> | null;
    emitChain: Promise<void>;
    finishStart: (() => void) | null;
  } | null = null;
  let previousChildExit: Promise<void> = Promise.resolve();

  const sendWithRetry = async (
    event: MachineDoubaoLoginEventBody,
    canSend: () => boolean,
  ): Promise<void> => {
    for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
      if (!canSend()) return;
      try {
        await opts.onEvent(event);
        return;
      } catch (error) {
        if (isPermanentHttpError(error) || attempt === retryDelaysMs.length) {
          opts.onEmitError?.(error, event);
          return;
        }
        await sleep(retryDelaysMs[attempt] ?? 200);
      }
    }
  };

  function cleanupDeadlineTimer(state: NonNullable<typeof active>) {
    if (state.timer !== null) {
      clearTimeout(state.timer);
      state.timer = null;
    }
  }

  function clearKillTimer(state: NonNullable<typeof active>) {
    if (state.killTimer !== null) {
      clearTimeout(state.killTimer);
      state.killTimer = null;
    }
  }

  function trackChildLifecycle(state: NonNullable<typeof active>, child: ChildProcess) {
    state.child = child;
    const exited = new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearKillTimer(state);
        if (state.child === child) state.child = null;
        resolve();
      };
      child.once('exit', finish);
      child.once('error', finish);
    });
    previousChildExit = exited;
  }

  function killChild(state: NonNullable<typeof active>) {
    const child = state.child;
    if (child === null || child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    if (state.killTimer !== null) return;
    state.killTimer = setTimeout(() => {
      state.killTimer = null;
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }, 500);
    state.killTimer.unref();
  }

  function enqueueEmit(
    state: NonNullable<typeof active>,
    event: MachineDoubaoLoginEventBody,
    settling = false,
    waitBeforeEmit?: () => Promise<void>,
  ): Promise<void> {
    state.emitChain = state.emitChain.then(async () => {
      if (waitBeforeEmit !== undefined) await waitBeforeEmit();
      await sendWithRetry(event, () =>
        settling
          ? !state.cancelled || event.status === 'cancelled'
          : active === state && !state.cancelled && !state.settled,
      );
    });
    return state.emitChain;
  }

  function settleState(
    state: NonNullable<typeof active>,
    event: Omit<MachineDoubaoLoginEventBody, 'revision'>,
    waitBeforeEmit?: () => Promise<void>,
  ): Promise<void> | null {
    if (state.settled) return null;
    state.settled = true;
    cleanupDeadlineTimer(state);
    if (active === state) active = null;
    const rev = ++state.revision;
    const delivered = enqueueEmit(
      state,
      { ...event, revision: rev } as MachineDoubaoLoginEventBody,
      true,
      waitBeforeEmit,
    );
    const finish = state.finishStart;
    state.finishStart = null;
    void delivered.finally(() => finish?.());
    return delivered;
  }

  function cancel(loginId?: string) {
    if (active === null) return;
    if (loginId !== undefined && active.loginId !== loginId) return;
    const target = active;
    target.cancelled = true;
    target.abortController.abort();
    const hadChild =
      target.child !== null && target.child.exitCode === null && target.child.signalCode === null;
    const exitWait = previousChildExit;
    killChild(target);
    settleState(
      target,
      { loginId: target.loginId, status: 'cancelled' },
      hadChild ? () => Promise.race([exitWait, sleep(650)]) : undefined,
    );
  }

  async function start(loginId: string, startOpts?: { logoutFirst?: boolean }): Promise<void> {
    if (active !== null) cancel(active.loginId);

    let resolveDone!: () => void;
    const donePromise = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });

    const state: NonNullable<typeof active> = {
      loginId,
      revision: 0,
      cancelled: false,
      settled: false,
      timedOut: false,
      abortController: new AbortController(),
      child: null,
      timer: null,
      killTimer: null,
      emitChain: Promise.resolve(),
      finishStart: resolveDone,
    };
    active = state;
    const isOpen = () => active === state && !state.cancelled && !state.settled;
    const nextRev = () => ++state.revision;

    if (!doubaoInstallSupported(platform, arch)) {
      await settleState(state, {
        loginId,
        status: 'failed',
        reason: 'unsupported_platform',
        detail: `当前平台（${platform}/${arch}）暂不支持豆包 CLI。`,
      });
      await donePromise;
      return;
    }

    state.timer = setTimeout(() => {
      if (!isOpen()) return;
      state.timedOut = true;
      state.abortController.abort();
      killChild(state);
      settleState(state, {
        loginId,
        status: 'expired',
        reason: 'expired',
        detail: '登录二维码已过期，请刷新后重新扫码。',
      });
    }, loginTimeoutMs);
    state.timer.unref();

    await enqueueEmit(state, { loginId, status: 'installing', revision: nextRev() });
    if (!isOpen()) {
      await donePromise;
      return;
    }

    let binary: { command: string } | null = null;
    try {
      binary = await opts.ensureBinary(state.abortController.signal);
    } catch {
      binary = null;
    }
    if (!isOpen()) {
      await donePromise;
      return;
    }
    if (binary === null) {
      await settleState(state, {
        loginId,
        status: 'failed',
        reason: 'install_failed',
        detail: '无法下载或校验豆包 CLI 运行时，请检查网络连接后重试。',
      });
      await donePromise;
      return;
    }

    const childEnv: NodeJS.ProcessEnv = {
      ...baseEnv,
      DOUBAO_CLI_NO_UPDATE_CHECK: '1',
      TERM: 'dumb',
    };

    await enqueueEmit(state, { loginId, status: 'starting', revision: nextRev() });
    await Promise.race([previousChildExit, sleep(650)]);
    if (!isOpen()) {
      await donePromise;
      return;
    }

    if (startOpts?.logoutFirst === true) {
      opts.onLogoutStart?.();
      const logoutProc = spawnLogout(binary.command, childEnv, logoutTimeoutMs);
      trackChildLifecycle(state, logoutProc.child);
      const logoutRes = await logoutProc.done;
      if (!isOpen()) {
        await donePromise;
        return;
      }
      if (!logoutRes.ok) {
        await settleState(state, {
          loginId,
          status: 'failed',
          reason: 'unknown',
          detail: logoutRes.detail ?? '退出当前豆包账号失败，请重试。',
        });
        await donePromise;
        return;
      }
    }

    const child = spawn(binary.command, ['login', '--qr=png'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnv,
    });
    trackChildLifecycle(state, child);

    let combined = '';
    let buffer = '';
    let invalidQr = false;

    const handleLine = (rawLine: string) => {
      if (!isOpen() || invalidQr) return;
      const line = rawLine.trim();
      if (line === '') return;
      const qrMatch = /QR_IMAGE=(.+)$/.exec(line);
      if (qrMatch?.[1] !== undefined) {
        const pngPath = qrMatch[1].trim();
        let bytes: Buffer;
        try {
          bytes = readFileSync(pngPath);
        } catch {
          invalidQr = true;
          killChild(state);
          return;
        }
        if (!isValidPngBuffer(bytes)) {
          invalidQr = true;
          killChild(state);
          return;
        }
        void enqueueEmit(state, {
          loginId,
          status: 'qr',
          revision: nextRev(),
          qrPngBase64: bytes.toString('base64'),
        });
        return;
      }
      if (line.includes('已扫描二维码')) {
        void enqueueEmit(state, { loginId, status: 'scanned', revision: nextRev() });
        return;
      }
      if (line.includes('手机已确认')) {
        void enqueueEmit(state, { loginId, status: 'verifying', revision: nextRev() });
      }
    };

    const appendChunk = (chunk: Buffer | string) => {
      const text = chunk.toString();
      combined += text;
      buffer += text;
      const parts = buffer.split(/\r?\n/);
      buffer = parts.pop() ?? '';
      for (const part of parts) handleLine(part);
    };

    child.stdout?.on('data', appendChunk);
    child.stderr?.on('data', appendChunk);

    child.once('error', (error) => {
      combined += `\n${error.message}`;
      if (!isOpen()) return;
      settleState(state, {
        loginId,
        status: 'failed',
        reason: 'unknown',
        detail: error.message.slice(0, 300) || '无法启动豆包登录进程，请重试。',
      });
    });

    child.once('exit', (code) => {
      if (buffer !== '') handleLine(buffer);
      if (!isOpen()) return;
      if (invalidQr) {
        settleState(state, {
          loginId,
          status: 'failed',
          reason: 'unknown',
          detail: '登录二维码图片无效或体积过大。',
        });
        return;
      }
      if (code === 0) {
        void opts
          .refreshProbe()
          .then((report) => {
            if (!isOpen()) return;
            if (report.authenticated) {
              settleState(state, {
                loginId,
                status: 'succeeded',
                doubao: { ...report, authenticated: report.authenticated === true },
              });
              return;
            }
            const failure = classifyDoubaoLoginFailure(combined, false);
            settleState(state, {
              loginId,
              status: 'failed',
              reason: failure.reason,
              detail: failure.detail ?? '登录已完成但本机验证未通过，请重试。',
            });
          })
          .catch(() => {
            if (!isOpen()) return;
            settleState(state, {
              loginId,
              status: 'failed',
              reason: 'unknown',
              detail: '无法验证登录状态，请重试。',
            });
          });
        return;
      }
      const failure = classifyDoubaoLoginFailure(combined, state.timedOut);
      settleState(state, {
        loginId,
        status: failure.status,
        reason: failure.reason,
        ...(failure.detail !== undefined ? { detail: failure.detail } : {}),
      });
    });

    await donePromise;
  }

  return {
    start,
    cancel,
    shutdown: () => cancel(),
    activeLoginId: () => active?.loginId ?? null,
  };
}
