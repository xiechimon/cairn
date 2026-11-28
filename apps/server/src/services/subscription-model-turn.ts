import type {
  MachineModelTurnClaim,
  MachineModelTurnResult,
  ProviderFailure,
  ProviderTestResult,
} from '@cairn/shared';
import type { Db } from '../db/client.js';
import type { MachineWakeHub } from './machine-wake-hub.js';
import { runnerProbeQueue } from './runner-probe-queue.js';
import { claimRateWindow } from './subscription-helpers.js';

export const modelTurnQueue = runnerProbeQueue<MachineModelTurnClaim, MachineModelTurnResult>(
  (hub, machineId, requestId) =>
    hub.sendToMachine(machineId, { type: 'provider.model-test', requestId }),
);

const attempts = new WeakMap<Db, Map<string, number>>();

export function modelTurnFailure(
  failure: ProviderFailure,
  reason: string = failure,
): ProviderTestResult {
  return { status: 'failed', failure, reason, httpStatus: null, detail: null, latencyMs: null };
}

export async function runSubscriptionModelTurn(
  db: Db,
  hub: MachineWakeHub,
  key: string,
  model: string,
  machines: readonly string[],
  claim: () => MachineModelTurnClaim,
  authorize: (machineId: string) => boolean,
  signal?: AbortSignal,
): Promise<ProviderTestResult> {
  if (!machines.some((machineId) => hub.connectionId(machineId) !== undefined)) {
    return modelTurnFailure('network', 'runner-unavailable');
  }
  claimRateWindow(attempts, db, `${key}:${model}`, 'tests of this model', 30_000);
  const started = performance.now();
  const result = await modelTurnQueue.dispatch(hub, machines, claim, authorize, signal);
  if (result.status === 'failed')
    return modelTurnFailure(
      result.failure,
      result.failure === 'network' ? 'runner-unavailable' : result.failure,
    );
  return {
    status: 'ok',
    failure: null,
    reason: null,
    httpStatus: null,
    detail: null,
    latencyMs: Math.round(performance.now() - started),
  };
}
