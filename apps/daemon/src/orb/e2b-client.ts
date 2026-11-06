import { CommandExitError, Sandbox, SandboxNotRunningError, TimeoutError } from 'e2b';
import type { E2bClient, E2bCommandExit, E2bSandbox } from './e2b-provider.js';

function sanitized(apiKey: string): (error: unknown) => Error {
  return (error) => {
    const message = error instanceof Error ? error.message : String(error);
    const clean = new Error(message.replaceAll(apiKey, '[redacted]'));
    clean.name = error instanceof Error ? error.name : 'Error';
    return clean;
  };
}

function exitOf(error: unknown): E2bCommandExit {
  if (error instanceof CommandExitError)
    return { exitCode: error.exitCode, timedOut: false, error: error.error };
  if (error instanceof SandboxNotRunningError || error instanceof TimeoutError)
    return { exitCode: -1, timedOut: true, error: error.message };
  return {
    exitCode: -1,
    timedOut: false,
    error: error instanceof Error ? error.message : String(error),
  };
}

function wrap(sandbox: Sandbox, apiKey: string): E2bSandbox {
  const clean = sanitized(apiKey);
  return {
    id: sandbox.sandboxId,
    async exec(command) {
      try {
        const result = await sandbox.commands.run(command);
        return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
      } catch (error) {
        if (error instanceof CommandExitError)
          return { exitCode: error.exitCode, stdout: error.stdout, stderr: error.stderr };
        throw clean(error);
      }
    },
    async start(command, options) {
      try {
        const handle = await sandbox.commands.run(command, {
          background: true,
          stdin: true,
          timeoutMs: 0,
          retainOutput: false,
          envs: options.envs,
          onStdout: options.onStdout,
          onStderr: options.onStderr,
        });
        return {
          sendStdin: (data) =>
            handle.sendStdin(data).catch((error: unknown) => Promise.reject(clean(error))),
          closeStdin: () =>
            handle.closeStdin().catch((error: unknown) => Promise.reject(clean(error))),
          kill: async () => {
            await handle.kill();
          },
          exited: handle.wait().then(
            () => ({ exitCode: 0, timedOut: false }),
            (error: unknown) => exitOf(error),
          ),
        };
      } catch (error) {
        throw clean(error);
      }
    },
    async kill() {
      try {
        await sandbox.kill();
      } catch (error) {
        throw clean(error);
      }
    },
  };
}

export function createE2bClient(apiKey: string): E2bClient {
  const clean = sanitized(apiKey);
  return {
    async create(options) {
      try {
        const sandbox = await Sandbox.create(options.template, {
          apiKey,
          timeoutMs: options.timeoutMs,
          metadata: options.metadata,
          ...(options.signal ? { signal: options.signal } : {}),
        });
        return wrap(sandbox, apiKey);
      } catch (error) {
        throw clean(error);
      }
    },
  };
}
