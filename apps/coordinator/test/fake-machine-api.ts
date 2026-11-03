import type {
  ClaimedStep,
  MachineDoneBody,
  MachineTokenResponse,
  StepRecord,
  TranscriptRow,
} from '@cairn/shared';
import type { MachineApi } from '../src/machine-api.js';

export interface FakeMachineApi extends MachineApi {
  queue: ClaimedStep[];
  claimedByMe: StepRecord[];
  rows: { stepId: string; row: TranscriptRow }[];
  deltas: { stepId: string; text: string }[];
  dones: { stepId: string; body: MachineDoneBody }[];
  heartbeats: string[];
  tools: { stepId: string; name: string; params: Record<string, unknown> }[];
  keys: string[];
  stopRequested: Set<string>;
  stopPolls: string[];
}

export function fakeMachineApi(apiKey = 'sk-test'): FakeMachineApi {
  const api: FakeMachineApi = {
    queue: [],
    claimedByMe: [],
    rows: [],
    deltas: [],
    dones: [],
    heartbeats: [],
    tools: [],
    keys: [],
    stopRequested: new Set(),
    stopPolls: [],
    claim: async () => {
      const next = api.queue.shift() ?? null;
      if (next) api.claimedByMe.push(next.step);
      return next;
    },
    recover: async () => [...api.claimedByMe],
    token: async (): Promise<MachineTokenResponse> => {
      api.keys.push(apiKey);
      return {
        provider: { kind: 'api_key', providerId: 'stub', apiKey },
        secrets: {},
        git: null,
      };
    },
    heartbeat: async (stepId) => {
      api.heartbeats.push(stepId);
    },
    stop: async (stepId) => {
      api.stopPolls.push(stepId);
      return api.stopRequested.has(stepId) ? false : null;
    },
    relayTool: async (stepId, name, params) => {
      api.tools.push({ stepId, name, params });
      return `result of ${name}`;
    },
    transcriptRow: async (stepId, row) => {
      api.rows.push({ stepId, row });
    },
    transcriptDelta: async (stepId, text) => {
      api.deltas.push({ stepId, text });
    },
    done: async (stepId, body) => {
      api.dones.push({ stepId, body });
      api.claimedByMe = api.claimedByMe.filter((s) => s.id !== stepId);
    },
  };
  return api;
}

export function chiefStep(
  id: string,
  instruction: string,
  systemPrompt = 'You are the Coordinator.',
  modelId = 'm',
): ClaimedStep {
  return {
    step: { id, buildId: 'chief-thread-1', kind: 'chief', machineId: 'sidecar', createdAt: 1 },
    conversationId: 'chief-thread-1',
    session: { action: 'new', sessionId: null },
    instruction,
    agent: {
      id: 'agent-1',
      displayName: 'Coordinator',
      description: '',
      provider: 'stub',
      modelId,
      thinkingLevel: null,
      memories: [],
    },
    chief: { threadId: 'chief-thread-1', systemPrompt, trigger: 'user' },
  };
}
