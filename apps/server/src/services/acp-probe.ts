import { spawn } from 'node:child_process';

export const ACP_PROBE_FORWARDED_ENV = [
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'https_proxy',
  'http_proxy',
  'all_proxy',
  'no_proxy',
  'LANG',
  'TZ',
] as const;

export function acpProbeEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  if (process.env.PATH !== undefined) env.PATH = process.env.PATH;
  for (const name of ACP_PROBE_FORWARDED_ENV) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

export function collectLines(buffer: string): { lines: string[]; rest: string } {
  const lines: string[] = [];
  let rest = buffer;
  let index = rest.indexOf('\n');
  while (index >= 0) {
    lines.push(rest.slice(0, index));
    rest = rest.slice(index + 1);
    index = rest.indexOf('\n');
  }
  return { lines, rest };
}

export interface AcpJsonRpcMessage {
  id?: number;
  result?: unknown;
  error?: { code?: number; message?: string };
}

export function runAcpJsonRpcProbe<R>(options: {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  initializeParams: unknown;
  timeoutResult: R;
  unavailableResult: R;
  failedResult: R;
  onErrorText: (text: string) => R;
  onMessage: (
    message: AcpJsonRpcMessage,
    controls: {
      write: (id: number, method: string, params: unknown) => void;
      finish: (result: R) => void;
    },
  ) => void;
}): Promise<R> {
  return new Promise((resolve) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let settled = false;
    let output = '';
    let buffer = '';
    const finish = (result: R) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGKILL');
      resolve(result);
    };
    const timer = setTimeout(() => finish(options.timeoutResult), options.timeoutMs);
    const write = (id: number, method: string, params: unknown) => {
      try {
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      } catch {
        finish(options.failedResult);
      }
    };
    child.on('error', (error: NodeJS.ErrnoException) => {
      finish(error.code === 'ENOENT' ? options.unavailableResult : options.failedResult);
    });
    child.stdout.on('data', (chunk: Buffer) => {
      const { lines, rest } = collectLines(buffer + chunk.toString('utf8'));
      buffer = rest;
      for (const line of lines) {
        if (line.trim() === '') continue;
        let parsed: AcpJsonRpcMessage;
        try {
          parsed = JSON.parse(line) as AcpJsonRpcMessage;
        } catch {
          continue;
        }
        options.onMessage(parsed, { write, finish });
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.on('close', (code) => {
      if (settled) return;
      finish(code === 0 ? options.failedResult : options.onErrorText(output));
    });
    write(1, 'initialize', options.initializeParams);
  });
}
