import {
  claimedStepSchema,
  machineAskResponseSchema,
  machineStopResponseSchema,
  machineTokenResponseSchema,
  stepRecordSchema,
} from '@cairn/shared';
import type { MachineApi } from '../../server/src/coordinator/runtime/machine-api.js';

export type { MachineApi };

const ASK_HOLD_MS = 70_000;
const ASK_REQUEST_TIMEOUT_MS = ASK_HOLD_MS + 15_000;
const ASK_RETRY_MS = 2_000;

export class MachineApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'MachineApiError';
  }
}

function field(body: unknown, name: string): unknown {
  if (body === null || typeof body !== 'object' || !(name in body)) {
    throw new Error(`server response has no ${name}`);
  }
  return (body as Record<string, unknown>)[name];
}

export function httpMachineApi(serverUrl: string, machineToken: string): MachineApi {
  const call = async (
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> => {
    const res = await fetch(new URL(path, serverUrl), {
      method,
      ...(signal === undefined ? {} : { signal }),
      headers: {
        authorization: `Bearer ${machineToken}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!res.ok) {
      throw new MachineApiError(
        res.status,
        `${method} ${path} -> ${res.status} ${await res.text()}`,
      );
    }
    return res.json();
  };
  return {
    claim: async () =>
      claimedStepSchema
        .nullable()
        .parse(
          field(await call('POST', '/api/machine/tasks/claim', { role: 'coordinator' }), 'step'),
        ),
    recover: async () =>
      stepRecordSchema.array().parse(field(await call('POST', '/api/machine/recover'), 'steps')),
    token: async (stepId) =>
      machineTokenResponseSchema.parse(await call('GET', `/api/machine/token/${stepId}`)),
    heartbeat: async (stepId) => {
      await call('POST', `/api/machine/heartbeat/${stepId}`);
    },
    stop: async (stepId) =>
      machineStopResponseSchema.parse(
        await call('GET', `/api/machine/stop?stepId=${encodeURIComponent(stepId)}`),
      ).discard,
    askUser: async (stepId, body, signal) => {
      for (;;) {
        const timeout = AbortSignal.timeout(ASK_REQUEST_TIMEOUT_MS);
        try {
          const settled = machineAskResponseSchema.parse(
            await call(
              'POST',
              `/api/machine/ask/${stepId}`,
              body,
              signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
            ),
          );
          if (settled.status !== 'pending') return settled;
        } catch (error) {
          if (error instanceof MachineApiError && error.status < 500) throw error;
          if (signal?.aborted === true) throw error;
          await new Promise((r) => setTimeout(r, ASK_RETRY_MS));
        }
      }
    },
    relayTool: async (stepId, name, params) =>
      String(field(await call('POST', `/api/machine/tool/${stepId}`, { name, params }), 'text')),
    transcriptRow: async (stepId, row) => {
      await call('POST', `/api/machine/tool/${stepId}`, { kind: 'transcript_row', row });
    },
    transcriptDelta: async (stepId, text) => {
      await call('POST', `/api/machine/tool/${stepId}`, { kind: 'transcript_delta', text });
    },
    done: async (stepId, body) => {
      await call('POST', `/api/machine/done/${stepId}`, body);
    },
  };
}
