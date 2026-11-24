import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DevinSubscriptionVerifyResult } from '@cairn/shared';
import { runAcpJsonRpcProbe } from './acp-probe.js';
import { childEnv, DEFAULT_DEVIN_TIMEOUT_MS, devinBin, errorReason } from './devin-cli.js';

function probe(
  token: string,
  home: string,
  timeoutMs: number,
): Promise<DevinSubscriptionVerifyResult> {
  const bin = devinBin(['acp']);
  return runAcpJsonRpcProbe<DevinSubscriptionVerifyResult>({
    command: bin.command,
    args: bin.args,
    cwd: home,
    env: childEnv(home, token),
    timeoutMs,
    initializeParams: {
      protocolVersion: 1,
      clientCapabilities: { session: {}, fs: { readTextFile: false, writeTextFile: false } },
    },
    timeoutResult: { ok: false, reason: 'timeout' },
    unavailableResult: { ok: false, reason: 'unavailable' },
    failedResult: { ok: false, reason: 'failed' },
    onErrorText: errorReason,
    onMessage: (message, { write, finish }) => {
      if (message.id === 1) {
        if (message.error !== undefined) {
          finish(errorReason(message.error.message ?? ''));
          return;
        }
        const result = message.result as { authMethods?: { id?: unknown }[] } | undefined;
        const methods = (result?.authMethods ?? [])
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
    },
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
