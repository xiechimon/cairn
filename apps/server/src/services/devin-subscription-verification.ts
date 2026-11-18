import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DevinSubscriptionVerifyResult } from '@cairn/shared';
import {
  childEnv,
  collectLines,
  DEFAULT_DEVIN_TIMEOUT_MS,
  devinBin,
  errorReason,
} from './devin-cli.js';

function probe(
  token: string,
  home: string,
  timeoutMs: number,
): Promise<DevinSubscriptionVerifyResult> {
  return new Promise((resolve) => {
    const bin = devinBin(['acp']);
    const child = spawn(bin.command, bin.args, {
      cwd: home,
      env: childEnv(home, token),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let settled = false;
    let output = '';
    let buffer = '';
    const finish = (result: DevinSubscriptionVerifyResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGKILL');
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), timeoutMs);
    const write = (id: number, method: string, params: unknown) => {
      try {
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      } catch {
        finish({ ok: false, reason: 'failed' });
      }
    };
    const onMessage = (line: string) => {
      let message: {
        id?: number;
        result?: { authMethods?: { id?: unknown }[] };
        error?: { code?: number; message?: string };
      };
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.id === 1) {
        if (message.error !== undefined) {
          finish(errorReason(message.error.message ?? ''));
          return;
        }
        const methods = (message.result?.authMethods ?? [])
          .map((method) => method.id)
          .filter((id): id is string => typeof id === 'string');
        const methodId = methods.find((id) => /devin|key|token/i.test(id)) ?? methods[0] ?? null;
        if (methodId !== null) {
          write(2, 'authenticate', { methodId, _meta: { api_key: token } });
        } else {
          write(3, 'session/new', { cwd: home, mcpServers: [] });
        }
        return;
      }
      if (message.id === 2 || message.id === 3) {
        finish(
          message.error === undefined ? { ok: true } : errorReason(message.error.message ?? ''),
        );
      }
    };
    child.on('error', (error: NodeJS.ErrnoException) => {
      finish(
        error.code === 'ENOENT'
          ? { ok: false, reason: 'unavailable' }
          : { ok: false, reason: 'failed' },
      );
    });
    child.stdout.on('data', (chunk: Buffer) => {
      const { lines, rest } = collectLines(buffer + chunk.toString('utf8'));
      buffer = rest;
      for (const line of lines) {
        if (line.trim() !== '') onMessage(line);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.on('close', (code) => {
      if (settled) return;
      finish(code === 0 ? { ok: false, reason: 'failed' } : errorReason(output));
    });
    write(1, 'initialize', {
      protocolVersion: 1,
      clientCapabilities: { session: {}, fs: { readTextFile: false, writeTextFile: false } },
    });
  });
}

export async function verifyDevinSubscription(
  token: string,
  options: { timeoutMs?: number } = {},
): Promise<DevinSubscriptionVerifyResult> {
  const home = await mkdtemp(join(tmpdir(), 'cairn-devin-verify-'));
  try {
    return await probe(token, home, options.timeoutMs ?? DEFAULT_DEVIN_TIMEOUT_MS);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}
