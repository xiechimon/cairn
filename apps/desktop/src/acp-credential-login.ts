import { type ChildProcess, spawn } from 'node:child_process';
import { createCredentialProfile } from '@cairn/shared/credential-profile';

const LOGIN_TIMEOUT_MS = 600_000;
const CHILD_TERM_GRACE_MS = 1_000;

type AuthFailure = 'spawn' | 'exit' | 'failed' | 'timeout' | 'cancelled';

interface LoginOptions {
  appData: string;
  bin: string;
  args: (home: string) => string[];
  env: (home: string) => NodeJS.ProcessEnv;
  credentialPath: (home: string) => string;
  pickMethod: (methods: { id?: unknown }[] | undefined) => string;
  signal: AbortSignal;
  onAuthenticating?: () => void;
  workerPath?: string;
}

export async function authenticateCredential(
  options: LoginOptions,
): Promise<{ ok: true; text: string | null } | { ok: false; reason: AuthFailure }> {
  if (options.signal.aborted) return { ok: false, reason: 'cancelled' };
  const profile = createCredentialProfile(options.appData);
  let releaseWorker: (() => Promise<void>) | undefined;
  try {
    const { bin, workerPath } = options;
    let child: ChildProcess;
    try {
      const args = options.args(profile.home);
      child = spawn(
        workerPath === undefined ? bin : process.execPath,
        workerPath === undefined ? args : [workerPath, bin, ...args],
        {
          cwd: profile.home,
          env: {
            ...process.env,
            ...profile.env,
            TMPDIR: profile.home,
            TMP: profile.home,
            TEMP: profile.home,
            ...options.env(profile.home),
            ...(workerPath === undefined ? {} : { ELECTRON_RUN_AS_NODE: '1' }),
          },
          stdio:
            workerPath === undefined ? ['pipe', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe', 'ipc'],
        },
      );
    } catch {
      return { ok: false, reason: 'spawn' };
    }
    child.stderr?.resume();
    const closed = new Promise<void>((resolve) => {
      child.once('close', () => resolve());
      if (workerPath !== undefined) child.once('exit', () => resolve());
    });
    if (workerPath !== undefined) {
      releaseWorker = async () => {
        if (child.connected) child.disconnect();
        await closed;
      };
    }
    const auth = await authenticate(child, options, closed);
    if (options.signal.aborted) return { ok: false, reason: 'cancelled' };
    if (auth !== 'authenticated') return { ok: false, reason: auth };
    return { ok: true, text: profile.readCredential(options.credentialPath(profile.home), true) };
  } finally {
    try {
      profile.cleanup();
    } finally {
      await releaseWorker?.();
    }
  }
}

function send(child: ChildProcess, id: number, method: string, params: object): void {
  try {
    child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  } catch (error) {
    console.debug('cairn: recoverable operation failed', error);
  }
}

async function authenticate(child: ChildProcess, options: LoginOptions, closed: Promise<void>) {
  const { signal } = options;
  let exited = false;
  let stopped: () => void = () => {};
  const exit = new Promise<void>((resolve) => {
    stopped = () => {
      exited = true;
      resolve();
    };
    void closed.then(stopped);
    child.on('message', (message) => {
      if (message === 'credential-cli-exited') stopped();
    });
    child.on('error', () => {
      if (child.pid === undefined) stopped();
    });
  });
  let abort = () => {};
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<'authenticated' | AuthFailure>((resolve) => {
      let settled = false;
      let authenticating = false;
      const finish = (outcome: 'authenticated' | AuthFailure) => {
        if (settled) return;
        settled = true;
        resolve(outcome);
      };
      abort = () => finish('cancelled');
      signal.addEventListener('abort', abort, { once: true });
      timeout = setTimeout(() => finish('timeout'), LOGIN_TIMEOUT_MS);
      child.stdin?.on('error', () => finish('exit'));
      child.once('error', () => finish('spawn'));
      void exit.then(() => finish('exit'));
      if (signal.aborted) {
        abort();
        return;
      }
      let buffer = '';
      child.stdout?.on('data', (chunk: Buffer) => {
        if (settled) return;
        buffer += chunk.toString();
        let newline = buffer.indexOf('\n');
        while (!settled && newline >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf('\n');
          try {
            const message = JSON.parse(line) as {
              id?: unknown;
              result?: { authMethods?: { id?: unknown }[] } | null;
              error?: unknown;
            };
            if (message.id === 1 && !authenticating) {
              if (message.error !== undefined) {
                finish('failed');
                return;
              }
              authenticating = true;
              options.onAuthenticating?.();
              send(child, 2, 'authenticate', {
                methodId: options.pickMethod(message.result?.authMethods),
              });
            } else if (message.id === 2 && authenticating) {
              finish(
                message.error === undefined &&
                  typeof message.result === 'object' &&
                  !Array.isArray(message.result)
                  ? 'authenticated'
                  : 'failed',
              );
            }
          } catch (error) {
            console.debug('cairn: recoverable operation failed', error);
          }
        }
      });
      send(child, 1, 'initialize', { protocolVersion: 1, clientCapabilities: {} });
    });
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
    if (!exited) {
      child.kill();
      const force = setTimeout(() => child.kill('SIGKILL'), CHILD_TERM_GRACE_MS);
      await exit.finally(() => clearTimeout(force));
    }
  }
}
