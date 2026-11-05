import { realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type {
  ClaimedStep,
  MachineDoneBody,
  MachineSkillsManifestResponse,
  ProviderConfig,
  ToolCallRecord,
} from '@cairn/shared';
import { isBuildStepKind } from '@cairn/shared';
import { createPiBackend } from '../../../../apps/daemon/src/backend/pi.js';
import type { ExecutorRecord } from '../../../../apps/daemon/src/executor-record.js';
import { StepJournal } from '../../../../apps/daemon/src/journal.js';
import type { DaemonLogger } from '../../../../apps/daemon/src/log.js';
import type { MachineApi } from '../../../../apps/daemon/src/machine-client.js';
import { runStep } from '../../../../apps/daemon/src/runner.js';
import { ensureStateDirs, statePaths } from '../../../../apps/daemon/src/state.js';

export interface ProductionTaskInput {
  root: string;
  taskDir: string;
  claimed: ClaimedStep;
  provider: ProviderConfig;
  skillsDir?: string;
  skillsManifest?: MachineSkillsManifestResponse;
  skillFiles?: ReadonlyMap<string, Buffer>;
  timeoutMs?: number;
}

export interface ProductionTaskResult {
  done: MachineDoneBody;
  executorRecord: ExecutorRecord;
  artifacts: Record<string, string>;
  tools: ToolCallRecord[];
  logs: string[];
}

export async function executeProductionTask(
  input: ProductionTaskInput,
): Promise<ProductionTaskResult> {
  const { claimed, provider } = input;
  if (
    !/^[a-zA-Z0-9_-]+$/.test(claimed.conversationId) ||
    !/^[a-zA-Z0-9_-]+$/.test(claimed.step.id)
  ) {
    throw new Error('Task identifiers must be path-safe');
  }
  if (claimed.project?.repo != null) throw new Error('Task snapshot must have repo:null');
  if (!isBuildStepKind(claimed.step.kind) || claimed.session.action !== 'new') {
    throw new Error('Production task requires one fresh implementation step');
  }
  if (claimed.agent?.provider !== provider.providerId || !claimed.agent.modelId) {
    throw new Error('Claimed model must match the supplied production provider');
  }
  if ((claimed.remoteTools?.length ?? 0) > 0 || (claimed.mcpServers?.length ?? 0) > 0) {
    throw new Error('External tools require a trusted task-specific transport');
  }
  if (resolve(dirname(input.taskDir), claimed.conversationId) !== resolve(input.taskDir)) {
    throw new Error('Expected task workspace at workspacesDir/conversationId');
  }
  const taskDir = realpathSync(input.taskDir);
  const workspacesDir = dirname(taskDir);
  if (resolve(workspacesDir, claimed.conversationId) !== taskDir) {
    throw new Error('Expected task workspace at workspacesDir/conversationId');
  }
  const privatePaths = statePaths(resolve(input.root, 'daemon'));
  ensureStateDirs(privatePaths);
  const paths = { ...privatePaths, workspacesDir };
  const logs: string[] = [];
  const artifacts: Record<string, string> = {};
  const tools: ToolCallRecord[] = [];
  const completions: MachineDoneBody[] = [];
  const log = (line: string) => {
    logs.push(line);
  };
  const logger: DaemonLogger = {
    raw: log,
    prefixed: (_prefix, line) => log(line),
    supervisor: log,
    machine: log,
    step: log,
    workspace: log,
    recover: log,
    wake: log,
    skills: log,
    gate: log,
    trust: log,
    mcp: log,
  };
  const unavailable = async (): Promise<never> => {
    throw new Error('Unavailable in isolated task transport');
  };
  const client: MachineApi = {
    enroll: unavailable,
    me: unavailable,
    presence: unavailable,
    recover: unavailable,
    claim: unavailable,
    syncResult: unavailable,
    stream: unavailable,
    attachment: unavailable,
    heartbeat: async () => {},
    transcriptDelta: async () => {},
    tool: async (_stepId, call) => {
      tools.push(call);
    },
    relayTool: unavailable,
    token: async () => ({ provider: { ...provider }, secrets: {}, git: null }),
    skillsManifest: async () => input.skillsManifest ?? { selection: 'whitelist', skills: [] },
    skillFile: async (_stepId, dirName, path) => {
      const bytes = input.skillFiles?.get(`${dirName}/${path}`);
      if (bytes === undefined) throw new Error('Missing distributed skill file');
      return bytes;
    },
    uploadUrls: async (_stepId, files) => ({
      uploads: files.map(({ name }) => ({ name, url: name, method: 'PUT' as const, headers: {} })),
    }),
    putUpload: async (name, _headers, body) => {
      if (!['transcript.json', 'PLAN.md', 'session.jsonl'].includes(name))
        throw new Error(`Unexpected artifact: ${name}`);
      artifacts[name] = typeof body === 'string' ? body : JSON.stringify(body);
    },
    done: async (_stepId, body) => {
      completions.push(body);
    },
    steer: async () => null,
    stop: async () => null,
  };
  const backend = createPiBackend({
    agentDir: paths.agentRuntimeDir,
    sessionDir: paths.chatSessionsDir,
    ...(input.skillsDir !== undefined
      ? { skills: { skillsDir: input.skillsDir, cwd: paths.home } }
      : {}),
    onSkillsLog: log,
    onTrustLog: log,
    onGateLog: log,
    onMcpLog: log,
  });
  await runStep(
    {
      client,
      journal: new StepJournal(paths.outboxDir),
      backendFor: () => backend,
      logger,
      paths,
      workspacesDir,
      mcpConfigPath: join(paths.home, 'mcp.json'),
      ...(input.skillsDir !== undefined ? { skillsDir: input.skillsDir } : {}),
    },
    claimed,
    {
      streamDurationCapMs: input.timeoutMs ?? 3_600_000,
      ...(input.timeoutMs !== undefined
        ? {
            streamTimeouts: {
              first: input.timeoutMs,
              idle: input.timeoutMs,
              body: input.timeoutMs,
            },
          }
        : {}),
    },
  );
  if (completions.length !== 1 || completions[0] === undefined)
    throw new Error('Runner did not deliver exactly one completion');
  const records = logs.filter((line) => line.startsWith('executor record '));
  if (records.length !== 1) throw new Error('Runner did not deliver exactly one executor record');
  const executorRecord = JSON.parse(
    records[0]?.slice('executor record '.length) ?? '',
  ) as ExecutorRecord;
  if (!artifacts['transcript.json'] || !artifacts['session.jsonl'])
    throw new Error('Runner did not deliver production transcript/session artifacts');
  return { done: completions[0], executorRecord, artifacts, tools, logs };
}
