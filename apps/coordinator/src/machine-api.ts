import {
  type ClaimedStep,
  claimedStepSchema,
  type MachineDoneBody,
  type MachineTokenResponse,
  machineStopResponseSchema,
  machineTokenResponseSchema,
  type StepRecord,
  stepRecordSchema,
  type TranscriptRow,
} from '@cairn/shared';

export interface MachineApi {
  claim(): Promise<ClaimedStep | null>;
  recover(): Promise<StepRecord[]>;
  token(stepId: string): Promise<MachineTokenResponse>;
  heartbeat(stepId: string): Promise<void>;
  stop(stepId: string): Promise<boolean | null>;
  relayTool(stepId: string, name: string, params: Record<string, unknown>): Promise<string>;
  transcriptRow(stepId: string, row: TranscriptRow): Promise<void>;
  transcriptDelta(stepId: string, text: string): Promise<void>;
  done(stepId: string, body: MachineDoneBody): Promise<void>;
}

function field(body: unknown, name: string): unknown {
  if (body === null || typeof body !== 'object' || !(name in body)) {
    throw new Error(`server response has no ${name}`);
  }
  return (body as Record<string, unknown>)[name];
}

export function httpMachineApi(serverUrl: string, machineToken: string): MachineApi {
  const call = async (method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> => {
    const res = await fetch(new URL(path, serverUrl), {
      method,
      headers: {
        authorization: `Bearer ${machineToken}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
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
