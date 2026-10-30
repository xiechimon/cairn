import type { ClaimedStep } from '@cairn/shared';
import type { MachineApi } from '../machine-client.js';
import type { RunStepOptions } from '../runner.js';
import type { StatePaths } from '../state.js';

export const ORB_RPC_PREFIX = 'cairn-orb-rpc:';
export const ORB_STEP_METHODS = [
  'heartbeat',
  'tool',
  'transcriptDelta',
  'thinkingDelta',
  'transcriptRow',
  'activity',
  'agentTodo',
  'relayTool',
  'askUser',
  'token',
  'skillsManifest',
  'skillFile',
  'attachment',
  'uploadUrls',
  'putUpload',
  'done',
  'reportClaudeRateLimit',
] as const satisfies readonly (keyof MachineApi)[];
export type OrbStepMethod = (typeof ORB_STEP_METHODS)[number];

export interface OrbStepInput {
  claimed: ClaimedStep;
  options: RunStepOptions;
  paths: StatePaths;
  workspacesDir: string;
  mcpConfigPath: string;
  skillsDir?: string;
  machineName?: string;
  hookTimeoutMs?: number;
  methods: OrbStepMethod[];
}

export type OrbFrame =
  | { type: 'init'; input: OrbStepInput }
  | { type: 'call'; id: number; method: OrbStepMethod; args: unknown[] }
  | { type: 'cancel'; id: number }
  | { type: 'reply'; id: number; value?: unknown; error?: string; status?: number; body?: string }
  | { type: 'stop'; discard: boolean }
  | { type: 'steer'; text: string; images?: readonly { data: string; mimeType: string }[] }
  | { type: 'log'; message: string }
  | { type: 'finished' }
  | { type: 'failed'; error: string };

export function encodeOrbFrame(frame: OrbFrame): string {
  return `${ORB_RPC_PREFIX}${JSON.stringify(frame)}\n`;
}

export function decodeOrbFrame(line: string): OrbFrame | null {
  if (!line.startsWith(ORB_RPC_PREFIX)) return null;
  try {
    return JSON.parse(line.slice(ORB_RPC_PREFIX.length)) as OrbFrame;
  } catch {
    return null;
  }
}
