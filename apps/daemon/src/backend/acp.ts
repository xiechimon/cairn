import {
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
  spawn,
} from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { Readable, Writable } from 'node:stream';
import {
  type ContentBlock,
  client,
  type LoadSessionResponse,
  type McpServer,
  methods,
  type NewSessionResponse,
  ndJsonStream,
  PROTOCOL_VERSION,
  type ResumeSessionResponse,
  type SessionConfigOption,
  type SessionUpdate,
  type SetSessionConfigOptionResponse,
} from '@agentclientprotocol/sdk';
import type {
  AgentBackend,
  AgentBackendCapabilities,
  AgentSessionHandle,
  AgentTokenUsage,
  BriefBackendId,
  BriefChannel,
  DeliveredImage,
  ModelSourceModel,
  ModelUsage,
  ProviderConfig,
  SessionOpts,
  StepEvent,
  StepFailureCode,
  StepFailureDetail,
  ToolCallRecord,
} from '@cairn/shared';
import {
  AGENT_TODO_MAX_ITEMS,
  acpThoughtLevel,
  acpThoughtLevels,
  acpThoughtValue,
  CLAUDE_TODO_STATUS_STATES,
  isInternalAntigravityModelId,
} from '@cairn/shared';
import { readJsonObject, writeJsonObject } from '../agent-config.js';
import { DAEMON_VERSION } from '../version.js';
import {
  type AcpToolCall,
  type AcpTurnPolicy,
  acpTurnPolicy,
  claudeAcpSessionMeta,
  decideAcpPermission,
  restrictiveAcpMode,
} from './acp-permission-gate.js';
import { type AcpStdioBridge, bridgeHttpMcpToStdio, openAcpTools } from './acp-tools.js';
import { installAntigravityTurnHooks } from './antigravity-hooks.js';

import { SessionNotResumableError, StepFailureError, stepFailureOf } from './errors.js';
import { isLearnedNoVision, rememberNoVision } from './image-support.js';
import { runtimeChildEnv } from './otel.js';

import { appendSkillsCatalog, composeSkillsSection } from './skills.js';

const spawnedProcessGroups = new Set<number>();

function terminateSpawnedProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
  if (signal === 'SIGKILL') spawnedProcessGroups.delete(pid);
}

process.once('exit', () => {
  for (const pid of spawnedProcessGroups) {
    try {
      terminateSpawnedProcessGroup(pid, 'SIGKILL');
    } catch {}
  }
});

export const GEMINI_CAPABILITIES: AgentBackendCapabilities = {
  name: 'gemini',
  thinkingLevels: [],
  oauthProviders: [],
  compaction: false,
  sessionResume: false,
};

export interface GeminiSessionValidation {
  cwd: string;
  modelId: string;
  resumeId?: string;
  prompt?: string;
  promptImages?: readonly unknown[];
  imageCapability?: boolean;
}

export function validateGeminiSession(opts: GeminiSessionValidation): {
  prompt: string | undefined;
  resumeId: string | undefined;
} {
  if ((opts.promptImages?.length ?? 0) > 0 && !opts.imageCapability) {
    throw new Error('gemini ACP backend: image capability is not advertised');
  }
  return { prompt: opts.prompt, resumeId: opts.resumeId };
}

function advertisedAcpModels(
  option: SessionConfigOption,
  thoughtByModel: Record<string, readonly SessionConfigOption[]>,
  skipId?: (id: string) => boolean,
): ModelSourceModel[] {
  if (option.type !== 'select') return [];
  const seen = new Set<string>();
  const models: ModelSourceModel[] = [];
  for (const entry of option.options) {
    const candidates = 'value' in entry ? [entry] : entry.options;
    for (const candidate of candidates) {
      if (
        candidate.value === '' ||
        seen.has(candidate.value) ||
        skipId?.(candidate.value) === true
      ) {
        continue;
      }
      seen.add(candidate.value);
      const options = thoughtByModel[candidate.value];
      models.push({
        id: candidate.value,
        name: candidate.name === '' ? candidate.value : candidate.name,
        ...(options === undefined ? {} : thoughtChoice(options)),
      });
    }
  }
  return models;
}

function isThoughtOption(option: SessionConfigOption): boolean {
  return (
    option.category === 'thought_level' || option.id === 'thought_level' || option.id === 'effort'
  );
}

function thoughtChoice(
  options: readonly SessionConfigOption[],
): Pick<ModelSourceModel, 'thinkingLevels' | 'thinkingDefault'> {
  const option = options.find(isThoughtOption);
  if (option === undefined) return { thinkingLevels: [] };
  const thinkingDefault = acpThoughtLevel(currentValueOf(option));
  const thinkingLevels = acpThoughtLevels(selectOptionValues(option));
  return thinkingDefault === undefined ? { thinkingLevels } : { thinkingLevels, thinkingDefault };
}

function currentValueOf(option: SessionConfigOption): string {
  return option.type === 'select' ? option.currentValue : '';
}

function selectOptionValues(option: SessionConfigOption): Set<string> {
  if (option.type !== 'select') return new Set();
  return new Set(
    option.options.flatMap((entry) =>
      'options' in entry ? entry.options.map((item) => item.value) : [entry.value],
    ),
  );
}

function boundedToolName(tool: string): string {
  const base = basename(tool);
  return (base !== '' ? base : tool).slice(0, 64);
}

interface AcpTerminalFailure {
  code: StepFailureCode;
  message: string;
  detail?: StepFailureDetail;
}

function isGeminiAuthMessage(message: string): boolean {
  return (
    /^Gemini login failed:/.test(message) ||
    /authenticate|required|not logged in|login|api key is missing|auth method|GEMINI_API_KEY/i.test(
      message,
    )
  );
}

function acpErrorCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'number' ? code : undefined;
}

function isAntigravityAuthError(error: unknown, message: string): boolean {
  return (
    acpErrorCode(error) === -32000 ||
    /authentication required|authenticate|not logged in|login|unauthorized|api key|auth method|no browser is available/i.test(
      message,
    )
  );
}

function antigravityAcpErrorMessage(error: unknown, message: string): string {
  if (/spawn .*ENOENT|\bagy\b.*not found/i.test(message)) {
    return 'Antigravity executable not found: install Google Antigravity (agy) on the Runner or enable managed install.';
  }
  if (isAntigravityAuthError(error, message)) {
    return `Antigravity login failed: sign in to Antigravity on the Runner or enable a subscription with a token. ${message}`;
  }
  return message;
}

export function acpErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/spawn agy .*ENOENT|\bagy\b.*not found/i.test(message)) {
    return 'Antigravity executable not found: install Google Antigravity (agy) on the Runner or enable managed install.';
  }
  if (
    /(antigravity|\bagy\b)/i.test(message) &&
    /authenticate|not logged in|login|unauthorized|api key|auth method/i.test(message)
  ) {
    return `Antigravity login failed: sign in to Antigravity on the Runner or enable a subscription with a token. ${message}`;
  }
  if (/spawn gemini .*ENOENT|gemini.*not found/i.test(message)) {
    return 'Gemini executable not found: the managed Gemini install is missing or still downloading';
  }
  if (
    /authenticate|required|not logged in|login|api key is missing|auth method|GEMINI_API_KEY/i.test(
      message,
    )
  ) {
    return `Gemini login failed: run gemini and complete its login flow. ${message}`;
  }
  return message;
}

export function mapAcpUpdate(update: SessionUpdate | { kind: 'cancelled' }): StepEvent | null {
  if ('kind' in update)
    return { type: 'message_stop', message: { role: 'assistant', content: '' } };
  if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') {
    return { type: 'text_delta', text: update.content.text };
  }
  if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
    return {
      type: 'toolcall_end',
      call: {
        id: update.toolCallId,
        name: update.name ?? update.title ?? 'unknown',
        arguments: 'rawInput' in update ? (update.rawInput ?? {}) : {},
        ...(update.status === 'failed' ? { isError: true } : {}),
      },
    };
  }
  return null;
}

const GEMINI_TOKEN_LIMIT = 1_048_576;
const GEMMA_4_TOKEN_LIMIT = 256_000;
const GEMMA_4_MODELS = new Set(['gemma-4-31b-it', 'gemma-4-26b-a4b-it']);

function geminiCompressionSettingsPath(home: string, modelId: string, compactAt: number): string {
  const limit = GEMMA_4_MODELS.has(modelId) ? GEMMA_4_TOKEN_LIMIT : GEMINI_TOKEN_LIMIT;
  return writeJsonObject(home, `.gemini/cairn-system/compress-${compactAt}-of-${limit}.json`, {
    model: { compressionThreshold: compactAt / limit },
  });
}

const ANTIGRAVITY_ACP_SETTINGS_FILE = '.gemini/antigravity-acp/settings.json';

function syncAntigravityToolPermission(home: string | undefined, policy: AcpTurnPolicy): void {
  if (!home || resolve(home) === resolve(homedir())) return;
  const existing = readJsonObject(join(home, ANTIGRAVITY_ACP_SETTINGS_FILE));
  if (policy === 'relay-only') {
    writeJsonObject(home, ANTIGRAVITY_ACP_SETTINGS_FILE, {
      ...existing,
      toolPermission: 'strict',
    });
    return;
  }
  if ('toolPermission' in existing) {
    const { toolPermission: _removed, ...rest } = existing;
    writeJsonObject(home, ANTIGRAVITY_ACP_SETTINGS_FILE, rest);
  }
}

interface AcpPromptUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedReadTokens?: number;
  cachedWriteTokens?: number;
  thoughtTokens?: number;
  totalTokens?: number;
}

interface AcpPromptResponse {
  stopReason?: string;
  usage?: AcpPromptUsage;
}

class AcpSession implements AgentSessionHandle {
  readonly sessionId: string;
  readonly events: AsyncIterable<StepEvent>;
  private readonly queue: StepEvent[] = [];
  private readonly waiters: Array<(result: IteratorResult<StepEvent>) => void> = [];
  private stopped = false;
  private readonly usageRows: ModelUsage[] = [];
  private promptStarted = false;
  private cancelled = false;
  private text = '';
  private rejectedCount = 0;
  private readonly calls = new Map<string, ToolCallRecord>();
  private readonly toolOutputs = new Map<string, unknown>();
  private readonly rawCalls = new Map<string, AcpToolCall>();
  private cancelTimer: ReturnType<typeof setTimeout> | undefined;
  private midTurnPrompt: Promise<AcpPromptResponse> | null = null;
  private readonly normalizer?: (update: SessionUpdate) => AcpUpdateNormalization;

  constructor(
    sessionId: string,
    private readonly connection: ReturnType<ReturnType<typeof client>['connect']>,
    private readonly prompt: string | undefined,
    private readonly images: readonly ContentBlock[],
    private readonly imageCapability: boolean,
    private readonly cleanup: () => void,
    private readonly adapter?: AcpBackendOptions,
    private readonly modelId = 'unknown',
    private readonly compactAt?: number,
    private readonly settleUnexpectedClose?: () => Promise<AcpTerminalFailure | null>,
  ) {
    this.sessionId = sessionId;
    this.normalizer = adapter?.createUpdateNormalizer?.();
    this.events = { [Symbol.asyncIterator]: () => this };
  }

  [Symbol.asyncIterator](): AsyncIterator<StepEvent> {
    return this;
  }

  async next(): Promise<IteratorResult<StepEvent>> {
    if (!this.promptStarted && !this.stopped) {
      this.promptStarted = true;
      void this.runPrompt();
    }
    const event = this.queue.shift();
    if (event !== undefined) return { done: false, value: event };
    if (this.stopped) return { done: true, value: undefined };
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private push(event: StepEvent): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter({ done: false, value: event });
    else this.queue.push(event);
  }

  private recordPromptUsage(usage: AcpPromptUsage | undefined): void {
    if (usage === undefined) return;
    const finite = (value: unknown): number | undefined =>
      typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : undefined;
    const inputTokens = finite(usage.inputTokens);
    const outputTokens = finite(usage.outputTokens);
    const cachedReadTokens = finite(usage.cachedReadTokens);
    const cachedWriteTokens = finite(usage.cachedWriteTokens);
    if (
      inputTokens === undefined &&
      outputTokens === undefined &&
      cachedReadTokens === undefined &&
      cachedWriteTokens === undefined
    ) {
      return;
    }
    const existing = this.usageRows[0];
    const input = inputTokens ?? existing?.input ?? 0;
    const cacheRead = cachedReadTokens ?? existing?.cacheRead ?? 0;
    const output = outputTokens ?? existing?.output ?? 0;
    const cacheWrite = cachedWriteTokens ?? existing?.cacheWrite ?? 0;
    const contextTokens =
      existing?.contextTokens !== undefined && existing.contextTokens > 0
        ? existing.contextTokens
        : input + cacheRead;
    this.usageRows.splice(0, this.usageRows.length, {
      model: this.modelId,
      input,
      output,
      cacheRead,
      cacheWrite,
      contextTokens,
      ...(existing?.contextWindow !== undefined ? { contextWindow: existing.contextWindow } : {}),
      ...(this.compactAt !== undefined ? { compactAt: this.compactAt } : {}),
    });
    if (this.adapter?.usageEvents === true) {
      this.push({ type: 'usage', usage: [...this.usageRows] });
    }
  }

  private async runPrompt(): Promise<void> {
    if (this.prompt === undefined) {
      this.finish();
      return;
    }
    try {
      let recoveryAttempted = false;
      let wait: Promise<AcpPromptResponse> = this.connection.agent.request(
        methods.agent.session.prompt,
        {
          sessionId: this.sessionId,
          prompt: [{ type: 'text', text: this.prompt }, ...this.images],
        },
      );
      for (;;) {
        const result = await wait;
        if (result.stopReason === 'interrupted' && this.midTurnPrompt !== null) {
          if (this.text) {
            this.push({
              type: 'message_end',
              message: { role: 'assistant', content: this.text },
            });
            this.text = '';
          }
          wait = this.midTurnPrompt;
          this.midTurnPrompt = null;
          continue;
        }
        if (
          this.adapter?.harness === 'antigravity' &&
          result.stopReason === 'end_turn' &&
          this.text.trim() === '' &&
          this.rejectedCount > 0 &&
          !recoveryAttempted
        ) {
          recoveryAttempted = true;
          wait = this.connection.agent.request(methods.agent.session.prompt, {
            sessionId: this.sessionId,
            prompt: [
              {
                type: 'text',
                text: 'Your previous built-in tool call was blocked by Cairn policy. Continue without retrying blocked built-in tools, use only allowed Cairn tools, and provide a complete response to the user.',
              },
            ],
          });
          continue;
        }
        if (this.text)
          this.push({ type: 'message_end', message: { role: 'assistant', content: this.text } });
        if (this.adapter && result.stopReason === 'cancelled' && !this.cancelled) {
          throw new Error('ACP agent cancelled the prompt without a stop request');
        }
        if (this.cancelled || result.stopReason === 'cancelled') {
          this.push({ type: 'message_stop', message: { role: 'assistant', content: this.text } });
        } else if (result.stopReason === 'end_turn') {
          if (this.adapter && [...this.calls.values()].some((call) => call.result === undefined)) {
            throw new Error('ACP prompt completed with unfinished tool calls');
          }
          this.recordPromptUsage(result.usage);
          this.push({ type: 'done', usage: this.usageRows });
        } else
          this.push({
            type: 'error',
            error: {
              message: `${this.adapter?.harness ?? 'Gemini'} ACP stopped: ${result.stopReason}`,
              retryable: false,
            },
          });
        break;
      }
    } catch (error) {
      if (this.cancelled) {
        this.push({ type: 'message_stop', message: { role: 'assistant', content: this.text } });
      } else {
        const rawMessage = error instanceof Error ? error.message : String(error);
        const runtime = this.adapter?.harness ?? 'gemini';
        const direct = stepFailureOf(error);
        const recorded =
          acpErrorCode(error) !== undefined
            ? null
            : ((await this.settleUnexpectedClose?.()) ?? null);
        const baseMessage =
          recorded !== null && !(error instanceof StepFailureError) && direct === null
            ? recorded.message
            : rawMessage;
        const message = this.adapter
          ? baseMessage
          : acpErrorMessage(
              recorded !== null && !(error instanceof StepFailureError) && direct === null
                ? baseMessage
                : error,
            );
        const isAuth =
          this.adapter?.harness === 'antigravity'
            ? isAntigravityAuthError(error, rawMessage) ||
              isAntigravityAuthError(error, baseMessage)
            : !this.adapter && (isGeminiAuthMessage(rawMessage) || isGeminiAuthMessage(message));
        const structured =
          direct !== null && direct.failureCode !== 'runtime_exited'
            ? direct
            : recorded !== null && recorded.code !== 'runtime_exited'
              ? { failureCode: recorded.code, failureDetail: recorded.detail }
              : isAuth
                ? { failureCode: 'auth' as const, failureDetail: { runtime } }
                : (direct ??
                  (recorded !== null
                    ? { failureCode: recorded.code, failureDetail: recorded.detail }
                    : null));
        this.push({
          type: 'error',
          error: {
            message,
            retryable: false,
            ...(structured?.failureCode === 'runtime_exited' ? { processCrash: true } : {}),
            ...(structured !== null ? { failureCode: structured.failureCode } : {}),
            ...(structured?.failureDetail !== undefined
              ? { failureDetail: structured.failureDetail }
              : {}),
          },
        });
      }
    } finally {
      this.finish();
    }
  }

  private finish(): void {
    if (this.stopped) return;
    clearTimeout(this.cancelTimer);
    this.stopped = true;
    this.cleanup();
    for (const waiter of this.waiters.splice(0)) waiter({ done: true, value: undefined });
  }

  describeToolCall(requested: AcpToolCall): AcpToolCall {
    const merged: Record<string, unknown> = { ...this.rawCalls.get(requested.toolCallId) };
    for (const [key, value] of Object.entries(requested)) {
      if (value !== undefined && value !== null) merged[key] = value;
    }
    return merged as AcpToolCall;
  }

  recordRejection(toolCall: AcpToolCall, reason: string): void {
    if (this.stopped) return;
    this.rejectedCount += 1;
    const previous = this.calls.get(toolCall.toolCallId);
    const call: ToolCallRecord = {
      id: toolCall.toolCallId,
      name: toolCall.name ?? toolCall.title ?? previous?.name ?? 'unknown',
      arguments: toolCall.rawInput ?? previous?.arguments ?? {},
      result: reason,
      isError: true,
      ...(previous?.parent !== undefined ? { parent: previous.parent } : {}),
    };
    this.calls.set(call.id, call);
    this.push({ type: 'toolcall_end', call });
  }

  onAcpUpdate(raw: SessionUpdate): void {
    if (raw.sessionUpdate === 'tool_call' || raw.sessionUpdate === 'tool_call_update') {
      const kept: Record<string, unknown> = { ...this.rawCalls.get(raw.toolCallId) };
      for (const [key, value] of Object.entries(raw)) {
        if (key !== 'sessionUpdate' && value !== undefined && value !== null) kept[key] = value;
      }
      this.rawCalls.set(raw.toolCallId, kept as AcpToolCall);
    }
    if (this.stopped || (this.adapter && !this.promptStarted)) return;
    let update = raw;
    let parent: string | undefined;
    if (this.normalizer !== undefined) {
      const normalized = this.normalizer(update);
      if (normalized.update === null) return;
      update = normalized.update;
      parent = normalized.parent;
    }
    if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text')
      this.text += update.content.text;
    if (update.sessionUpdate === 'usage_update' && this.adapter?.usageEvents === true) {
      const meta = update._meta as Record<string, unknown> | undefined;
      const num = (key: string) => {
        const value = meta?.[`cognition.ai/${key}`];
        return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0;
      };
      this.usageRows.splice(0, this.usageRows.length, {
        model: this.modelId,
        input: num('inputTokens') || update.used,
        output: num('outputTokens'),
        cacheRead: num('cachedReadTokens'),
        cacheWrite: num('cachedWriteTokens'),
        contextTokens: update.used,
        contextWindow: update.size,
        ...(this.compactAt !== undefined ? { compactAt: this.compactAt } : {}),
      });
      this.push({ type: 'usage', usage: [...this.usageRows] });
      return;
    }
    if (update.sessionUpdate === 'agent_thought_chunk' && update.content.type === 'text') {
      this.push({ type: 'thinking_delta', text: update.content.text });
    } else if (
      update.sessionUpdate === 'tool_call' ||
      update.sessionUpdate === 'tool_call_update'
    ) {
      const previous = this.calls.get(update.toolCallId);
      const call: ToolCallRecord = {
        id: update.toolCallId,
        name: update.name ?? update.title ?? previous?.name ?? 'unknown',
        arguments: update.rawInput ?? previous?.arguments ?? {},
        ...(previous?.result !== undefined ? { result: previous.result } : {}),
        ...(update.content != null ? { result: update.content } : {}),
        ...(update.status === 'failed' || update.status === 'completed'
          ? { isError: update.status === 'failed' }
          : {}),
        ...(parent !== undefined || previous?.parent !== undefined
          ? { parent: parent ?? previous?.parent }
          : {}),
      };
      if (this.adapter) {
        if (update.rawOutput != null) this.toolOutputs.set(call.id, update.rawOutput);
        else if (update.content != null) this.toolOutputs.set(call.id, update.content);
        const terminal =
          update.status === 'completed' ||
          update.status === 'failed' ||
          previous?.isError !== undefined;
        if (terminal) {
          call.result = this.toolOutputs.get(call.id) ?? previous?.result ?? '';
          call.isError =
            update.status === 'failed' ||
            (update.status !== 'completed' && previous?.isError === true);
        } else delete call.result;
        this.calls.set(call.id, call);
        if (
          JSON.stringify(call) !== JSON.stringify(previous) &&
          (!previous ||
            terminal ||
            update.rawInput != null ||
            update.name != null ||
            update.title != null)
        ) {
          this.push({ type: 'toolcall_end', call });
        }
      } else {
        this.calls.set(call.id, call);
        this.push({ type: 'toolcall_end', call });
      }
    } else if (update.sessionUpdate === 'plan') {
      const todo = update.entries.flatMap((entry) => {
        const state = CLAUDE_TODO_STATUS_STATES[entry.status];
        return entry.content.trim() !== '' && state !== undefined
          ? [{ text: entry.content.trim(), state }]
          : [];
      });
      this.push({
        type: 'toolcall_end',
        call: {
          id: `plan-${randomUUID()}`,
          name: 'plan',
          arguments: { entries: update.entries },
          result: '',
          isError: false,
          todo: todo.slice(0, AGENT_TODO_MAX_ITEMS),
        },
      });
    } else {
      const event = mapAcpUpdate(update);
      if (event) this.push(event);
    }
  }

  get acceptingPermissions(): boolean {
    return this.promptStarted && !this.stopped && !this.cancelled;
  }

  get isStopping(): boolean {
    return this.cancelled || this.stopped;
  }

  async steer(text: string, images: readonly DeliveredImage[] = []): Promise<void> {
    if (this.adapter && this.adapter.steering !== 'mid-turn')
      throw new Error('ACP steer is unsupported during a step');
    if (images.length > 0 && !this.imageCapability) {
      throw new Error(
        `${this.adapter?.harness ?? 'gemini'} ACP backend: image capability is not advertised`,
      );
    }
    const prompt = {
      sessionId: this.sessionId,
      prompt: [
        { type: 'text', text },
        ...images.map((image) => ({ type: 'image' as const, ...image })),
      ],
    };
    if (this.adapter?.steering === 'mid-turn') {
      const request = this.connection.agent.request<{ stopReason?: string }>(
        methods.agent.session.prompt,
        prompt,
      );
      request.catch(() => {});
      this.midTurnPrompt = request;
      return;
    }
    await this.connection.agent.request(methods.agent.session.prompt, prompt);
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.cancelled = true;
    if (this.adapter) {
      if (!this.promptStarted) {
        this.push({ type: 'message_stop', message: { role: 'assistant', content: this.text } });
        this.finish();
        return;
      }
      this.cancelTimer ??= setTimeout(
        () => this.connection.close(new Error('ACP cancellation timed out')),
        this.adapter.cancelTimeoutMs ?? 2_000,
      );
      this.cancelTimer.unref();
    }
    await this.connection.agent.notify(methods.agent.session.cancel, { sessionId: this.sessionId });
  }

  usage(): AgentTokenUsage {
    return this.usageRows;
  }
}

export interface AcpGateOptions {
  log?: (message: string) => void;
}

export interface AcpResolvedLaunch {
  command: string;
  args: string[];
  release?: () => void;
}

export interface GeminiBackendOptions {
  gate?: AcpGateOptions;
  executablePath?: string;
  executableArgs?: readonly string[];
  resolveLaunch?: () => AcpResolvedLaunch | null;
  permissions?: 'deny' | 'allow-once';
  skills?: { skillsDir: string; cwd: string };
  onSkillsLog?: (msg: string) => void;
  spawnProcess?: (
    command: string,
    args: string[],
    options: SpawnOptionsWithoutStdio,
  ) => Pick<ChildProcessWithoutNullStreams, 'stdin' | 'stdout' | 'stderr'> &
    Pick<ChildProcess, 'once' | 'kill' | 'pid'>;
}

class AcpBackend implements AgentBackend {
  private readonly imageSupport = new Map<string, boolean>();
  readonly capabilities: AgentBackendCapabilities;
  readonly brief?: BriefChannel;

  constructor(
    private readonly options: GeminiBackendOptions & { adapter?: AcpBackendOptions } = {},
  ) {
    const adapter = options.adapter;
    this.capabilities = adapter
      ? {
          ...GEMINI_CAPABILITIES,
          name: `${adapter.harness}-acp`,
          steering: adapter.steering === 'mid-turn',
          sessionResume: adapter.sessionResume === true,
        }
      : GEMINI_CAPABILITIES;
    const skills = options.skills ?? adapter?.skills;
    const onSkillsLog = options.onSkillsLog ?? adapter?.onSkillsLog;
    const briefId: BriefBackendId | null = !adapter
      ? 'gemini'
      : adapter.harness === 'devin' ||
          adapter.harness === 'claude-code' ||
          adapter.harness === 'antigravity'
        ? adapter.harness
        : null;
    if (briefId !== null) {
      this.brief = {
        backendId: briefId,
        composeBody: (sessionOpts, base) =>
          appendSkillsCatalog(
            base,
            composeSkillsSection(
              skills,
              {
                ...(sessionOpts.skillsAllowlist !== undefined
                  ? { skillsAllowlist: sessionOpts.skillsAllowlist }
                  : {}),
                ...(sessionOpts.injectedSkills !== undefined
                  ? { injectedSkills: sessionOpts.injectedSkills }
                  : {}),
                ...(sessionOpts.teamSkillsDir !== undefined
                  ? { teamSkillsDir: sessionOpts.teamSkillsDir }
                  : {}),
                ...(sessionOpts.onSkillsResolved !== undefined
                  ? { onSkillsResolved: sessionOpts.onSkillsResolved }
                  : {}),
              },
              onSkillsLog,
            ),
          ) ?? '',
      };
    }
  }

  async modelSupportsImages(provider: ProviderConfig, modelId: string): Promise<boolean | null> {
    if (isLearnedNoVision(provider.providerId, modelId)) return false;
    return this.imageSupport.get(`${provider.providerId}/${modelId}`) ?? null;
  }

  rememberNoVision(provider: ProviderConfig, modelId: string): void {
    rememberNoVision(provider.providerId, modelId);
  }

  async createSession(opts: SessionOpts): Promise<AgentSessionHandle> {
    return this.open(opts, undefined);
  }

  async continueSession(id: string, opts: SessionOpts): Promise<AgentSessionHandle> {
    return this.open(opts, id);
  }

  private async open(opts: SessionOpts, resumeId: string | undefined): Promise<AgentSessionHandle> {
    const adapter = this.options.adapter;
    if (
      adapter &&
      opts.mcpServers !== undefined &&
      adapter.allowHostMcp !== true &&
      opts.remoteToolsOnly !== true
    )
      throw new Error(
        'ACP mcpServers policy is unsupported: adapter host MCP configuration is not isolated',
      );
    const policy = acpTurnPolicy(opts);
    const validated = validateGeminiSession({
      cwd: opts.cwd,
      modelId: opts.modelId,
      ...(resumeId !== undefined ? { resumeId } : {}),
      ...(opts.prompt !== undefined ? { prompt: opts.prompt } : {}),
    });
    const hostTools = await openAcpTools(
      opts,
      adapter?.harness === 'antigravity' ? { maxToolBytes: 950, deferTools: true } : undefined,
    );
    const hostToolNames =
      hostTools?.toolNames ??
      [...(opts.remoteTools ?? []), ...(opts.localTools ?? [])].map((tool) => tool.name);
    const mcpBridges: AcpStdioBridge[] = [];
    const spawnProcess = this.options.spawnProcess ?? spawn;
    const resolver = adapter?.resolveLaunch ?? this.options.resolveLaunch;
    const resolvedLaunch = resolver !== undefined ? resolver() : null;
    const runtime = adapter?.harness ?? 'gemini';
    const releaseLaunch = resolvedLaunch?.release;
    const command = resolvedLaunch?.command ?? adapter?.command ?? this.options.executablePath;
    if (resolver !== undefined && resolvedLaunch === null) {
      hostTools?.close();
      throw new StepFailureError(
        `${runtime} managed runtime binary is unavailable or failed integrity verification`,
        'missing_tool',
        { runtime, tool: runtime },
      );
    }
    if (command === undefined) {
      releaseLaunch?.();
      hostTools?.close();
      throw new StepFailureError(
        'Gemini managed install is missing: the managed runtime setup did not complete',
        'missing_tool',
        { runtime, tool: runtime },
      );
    }
    const releaseRuntime = adapter?.acquireRuntime?.();
    let cleanupHooks: (() => void) | undefined;
    let child: ReturnType<NonNullable<GeminiBackendOptions['spawnProcess']>>;
    try {
      const rawArgs =
        resolvedLaunch !== null
          ? [...resolvedLaunch.args]
          : adapter
            ? [...(adapter.args ?? [])]
            : [...(this.options.executableArgs ?? ['--acp'])];
      const args =
        adapter?.harness === 'antigravity' &&
        rawArgs.includes('acp') &&
        !rawArgs.some((arg) => arg.startsWith('--include-default-customizations'))
          ? [...rawArgs, '--include-default-customizations=false']
          : rawArgs;
      const sessionEnv: NodeJS.ProcessEnv = { ...opts.env };
      const geminiHome = sessionEnv.GEMINI_CLI_HOME;
      if (!adapter && opts.compactAt !== undefined && geminiHome !== undefined) {
        sessionEnv.GEMINI_CLI_SYSTEM_SETTINGS_PATH = geminiCompressionSettingsPath(
          geminiHome,
          opts.modelId,
          opts.compactAt,
        );
      }
      if (adapter?.harness === 'devin') {
        for (const key of Object.keys(sessionEnv)) {
          if (key.startsWith('CHISEL_') || key.startsWith('DEVIN_')) delete sessionEnv[key];
        }
      }
      if (adapter?.harness === 'antigravity') {
        sessionEnv.AGY_CLI_DISABLE_AUTO_UPDATE = '1';
        syncAntigravityToolPermission(sessionEnv.HOME, policy);
        cleanupHooks = installAntigravityTurnHooks(opts.cwd, policy);
      }
      const env = runtimeChildEnv(sessionEnv);
      child = spawnProcess(command, args, {
        cwd: opts.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        ...(process.platform !== 'win32' ? { detached: true } : {}),
        env,
      });
    } catch (error) {
      cleanupHooks?.();
      releaseRuntime?.();
      releaseLaunch?.();
      hostTools?.close();
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new StepFailureError(
          error instanceof Error ? error.message : String(error),
          'missing_tool',
          { runtime, tool: boundedToolName(command) },
        );
      }
      throw error;
    }
    const groupPid = process.platform !== 'win32' ? child.pid : undefined;
    if (groupPid !== undefined) spawnedProcessGroups.add(groupPid);
    let stderr = '';
    const app = client({ name: 'cairn' });
    const gateOptions = this.options.gate;
    app.onRequest(methods.client.session.requestPermission, ({ params }) => {
      const accepting =
        session?.acceptingPermissions === true && params.sessionId === session.sessionId;
      const toolCall = session ? session.describeToolCall(params.toolCall) : params.toolCall;
      const decision = accepting
        ? decideAcpPermission({
            policy,
            toolCall,
            hostToolNames,
            normal: {
              mode: adapter
                ? (adapter.permissions ?? 'deny')
                : (this.options.permissions ?? 'allow-once'),
            },
          })
        : {
            allow: false,
            reason: 'Cairn permission gate rejected: the session is not accepting permissions',
          };
      const allow = decision.allow;
      if (!allow) {
        session?.recordRejection(toolCall, decision.reason);
        gateOptions?.log?.(`reject: policy=${policy} ${decision.reason}`);
      }
      const option = params.options
        .filter((value) => value.optionId !== 'plan_bypass')
        .find((value) => value.kind === (allow ? 'allow_once' : 'reject_once'));
      return {
        outcome: option
          ? { outcome: 'selected', optionId: option.optionId }
          : { outcome: 'cancelled' },
      };
    });
    let session: AcpSession | null = null;
    app.onNotification(methods.client.session.update, ({ params }) => {
      if (session && (!adapter || params.sessionId === session.sessionId))
        session.onAcpUpdate(params.update);
    });
    const stream = ndJsonStream(
      Writable.toWeb(child.stdin),
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    );
    const connection = app.connect(stream);
    let interactiveAuthDetected = false;
    let exited = false;
    let cleanedUp = false;
    let stdoutEnded = false;
    let terminalFailure: AcpTerminalFailure | null = null;
    child.stdout.once('end', () => {
      stdoutEnded = true;
    });
    const recordTerminalFailure = (
      code: StepFailureCode,
      message: string,
      detail?: StepFailureDetail,
    ): AcpTerminalFailure => {
      if (
        terminalFailure === null ||
        (terminalFailure.code === 'runtime_exited' && code !== 'runtime_exited')
      ) {
        terminalFailure = { code, message, ...(detail !== undefined ? { detail } : {}) };
      }
      return terminalFailure;
    };
    const captureChildExit = (code: number | null, signal: NodeJS.Signals | null) => {
      if (cleanedUp || session?.isStopping === true) return;
      const exitLabel = signal !== null && code === null ? signal : String(code);
      const detail: StepFailureDetail = {
        runtime,
        ...(code !== null ? { exitCode: code } : {}),
        ...(signal !== null ? { signal: signal.slice(0, 24) } : {}),
      };
      const recorded = recordTerminalFailure(
        'runtime_exited',
        `${runtime} ACP exited (${exitLabel}): ${stderr}`,
        detail,
      );
      connection.close(new StepFailureError(recorded.message, recorded.code, recorded.detail));
    };
    const settleUnexpectedClose = async (): Promise<AcpTerminalFailure | null> => {
      if (terminalFailure !== null) return terminalFailure;
      if (cleanedUp || session?.isStopping === true) return null;
      const proc = child as { exitCode?: number | null; signalCode?: NodeJS.Signals | null };
      if (
        (proc.exitCode === undefined || proc.exitCode === null) &&
        (proc.signalCode === undefined || proc.signalCode === null) &&
        stdoutEnded
      ) {
        await new Promise<void>((resolve) => {
          let settled = false;
          const done = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve();
          };
          const timer = setTimeout(done, 200);
          timer.unref?.();
          child.once('exit', done);
        });
      }
      if (
        terminalFailure === null &&
        ((proc.exitCode !== undefined && proc.exitCode !== null) ||
          (proc.signalCode !== undefined && proc.signalCode !== null))
      ) {
        captureChildExit(proc.exitCode ?? null, proc.signalCode ?? null);
      }
      return terminalFailure;
    };
    child.stderr.on('data', (chunk: Buffer) => {
      if (interactiveAuthDetected) return;
      const text = chunk.toString();
      if (
        adapter?.harness === 'antigravity' &&
        /Open the following link to authenticate/i.test(stderr + text)
      ) {
        interactiveAuthDetected = true;
        const recorded = recordTerminalFailure(
          'auth',
          'Antigravity OAuth login expired or revoked; sign in again in Settings -> Model Routing',
          { runtime },
        );
        connection.close(new StepFailureError(recorded.message, recorded.code, recorded.detail));
        return;
      }
      stderr = (stderr + text).slice(-8192);
    });
    child.once('error', (error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        const recorded = recordTerminalFailure('missing_tool', error.message, {
          runtime,
          tool: boundedToolName(command),
        });
        connection.close(new StepFailureError(recorded.message, recorded.code, recorded.detail));
        return;
      }
      connection.close(error);
    });
    child.once('exit', (code, signal) => captureChildExit(code, signal));
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let releaseTimer: ReturnType<typeof setTimeout> | undefined;
    const releaseOnce = () => {
      clearTimeout(releaseTimer);
      releaseLaunch?.();
    };
    child.once('close', () => {
      exited = true;
      if (groupPid === undefined) clearTimeout(killTimer);
      if (cleanedUp) releaseOnce();
    });
    const terminate = (signal: NodeJS.Signals) => {
      if (groupPid !== undefined) {
        try {
          terminateSpawnedProcessGroup(groupPid, signal);
        } catch {
          child.kill(signal);
        }
      } else if (!exited) child.kill(signal);
    };
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      cleanupHooks?.();
      releaseRuntime?.();
      hostTools?.close();
      for (const bridge of mcpBridges) bridge.close();
      mcpBridges.length = 0;
      connection.close();
      terminate('SIGTERM');
      if (exited) {
        releaseOnce();
      } else {
        releaseTimer = setTimeout(releaseOnce, 2_000);
        releaseTimer.unref();
      }
      if (adapter && (groupPid !== undefined || !exited)) {
        killTimer = setTimeout(() => terminate('SIGKILL'), 1_000);
      }
    };
    const initializeTimeoutMs = adapter?.initializeTimeoutMs ?? 30_000;
    const initializeTimer = adapter
      ? setTimeout(() => {
          const recorded = recordTerminalFailure(
            'runtime_startup_timeout',
            'ACP initialization timed out',
            { runtime, timeoutMs: initializeTimeoutMs },
          );
          connection.close(new StepFailureError(recorded.message, recorded.code, recorded.detail));
        }, initializeTimeoutMs)
      : undefined;
    initializeTimer?.unref();
    let agentVersion: number | string = 'unavailable';
    try {
      const initialized = await connection.agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, session: {} },
        clientInfo: { name: 'cairn', version: DAEMON_VERSION },
      });
      agentVersion = initialized.protocolVersion;
      if (agentVersion !== PROTOCOL_VERSION) throw new Error('Protocol version mismatch');
      const caps = initialized.agentCapabilities;
      this.imageSupport.set(
        `${opts.provider.providerId}/${opts.modelId}`,
        caps?.promptCapabilities?.image === true,
      );
      if (adapter) {
        if ((opts.promptImages?.length ?? 0) > 0 && !caps?.promptCapabilities?.image) {
          throw new Error(`${adapter.harness} ACP backend: image capability is not advertised`);
        }
      } else
        validateGeminiSession({
          ...opts,
          imageCapability: caps?.promptCapabilities?.image === true,
        });
      if (adapter && resumeId && !caps?.sessionCapabilities?.resume && !caps?.loadSession) {
        throw new Error('ACP resume is unsupported by this adapter');
      }
      const isRestricted = policy !== 'normal' || opts.lockedDown === true;
      const externalMcpAllowed = (!adapter || adapter.allowHostMcp === true) && !isRestricted;
      const externalMcpServers: McpServer[] = [];
      if (externalMcpAllowed) {
        for (const endpoint of opts.mcpServers ?? []) {
          if (endpoint.transport === 'http' && endpoint.url !== undefined) {
            if (caps?.mcpCapabilities?.http === true) {
              externalMcpServers.push({
                type: 'http',
                name: endpoint.slug,
                url: endpoint.url,
                headers: Object.entries(endpoint.headers ?? {}).map(([name, value]) => ({
                  name,
                  value,
                })),
              });
            } else {
              const bridge = await bridgeHttpMcpToStdio(endpoint);
              mcpBridges.push(bridge);
              externalMcpServers.push(bridge.declaration);
            }
          } else if (endpoint.transport === 'stdio' && endpoint.command !== undefined) {
            externalMcpServers.push({
              name: endpoint.slug,
              command: endpoint.command,
              args: endpoint.args ?? [],
              env: Object.entries(endpoint.env ?? {}).map(([name, value]) => ({
                name,
                value,
              })),
            });
          }
        }
      }
      const combinedSystemPrompt =
        opts.systemPrompt && hostTools?.systemPromptAppendix
          ? `${opts.systemPrompt}\n\n${hostTools.systemPromptAppendix}`
          : (opts.systemPrompt ?? hostTools?.systemPromptAppendix);
      const sessionMeta =
        adapter?.harness === 'claude-code'
          ? claudeAcpSessionMeta(policy)
          : adapter?.harness === 'antigravity' && !resumeId && combinedSystemPrompt
            ? { antigravity: { systemPrompt: { append: combinedSystemPrompt } } }
            : undefined;
      const request = {
        cwd: opts.cwd,
        ...(sessionMeta !== undefined ? { _meta: sessionMeta } : {}),
        mcpServers: [...externalMcpServers, ...(hostTools ? [hostTools.declaration] : [])],
      };
      const response = resumeId
        ? await (async () => {
            if (caps?.sessionCapabilities?.resume) {
              try {
                return await connection.agent.request<ResumeSessionResponse>(
                  methods.agent.session.resume,
                  { ...request, sessionId: resumeId },
                );
              } catch (error) {
                const crash = await settleUnexpectedClose();
                if (crash !== null) {
                  throw new StepFailureError(crash.message, crash.code, crash.detail);
                }
                const detail = error instanceof Error ? error.message : String(error);
                if (adapter?.harness === 'antigravity' && isAntigravityAuthError(error, detail)) {
                  throw error;
                }
                if (!caps?.loadSession) {
                  throw new SessionNotResumableError(resumeId, detail);
                }
              }
            }
            if (caps?.loadSession) {
              try {
                return await connection.agent.request<LoadSessionResponse>(
                  methods.agent.session.load,
                  { ...request, sessionId: resumeId },
                );
              } catch (error) {
                const crash = await settleUnexpectedClose();
                if (crash !== null) {
                  throw new StepFailureError(crash.message, crash.code, crash.detail);
                }
                const detail = error instanceof Error ? error.message : String(error);
                if (adapter?.harness === 'antigravity' && isAntigravityAuthError(error, detail)) {
                  throw error;
                }
                throw new SessionNotResumableError(resumeId, detail);
              }
            }
            throw new SessionNotResumableError(resumeId);
          })()
        : await connection.agent.request<NewSessionResponse>(methods.agent.session.new, request);
      const sessionId =
        'sessionId' in response && typeof response.sessionId === 'string'
          ? response.sessionId
          : resumeId;
      if (!sessionId) throw new Error(`${adapter?.harness ?? 'Gemini'} ACP returned no sessionId`);
      const modelOption = response.configOptions?.find((option) => option.category === 'model');
      let configOptions = response.configOptions ?? [];
      if (modelOption) {
        const selected = await connection.agent.request<SetSessionConfigOptionResponse>(
          methods.agent.session.setConfigOption,
          { sessionId, configId: modelOption.id, value: opts.modelId },
        );
        configOptions = selected.configOptions ?? [];
        if (adapter?.harness === 'devin') {
          const models = advertisedAcpModels(modelOption, {
            [currentValueOf(modelOption)]: response.configOptions ?? [],
            [opts.modelId]: configOptions,
          });
          if (models.length > 0) adapter.onDevinModels?.(models);
        } else if (adapter?.harness === 'antigravity') {
          const models = advertisedAcpModels(
            modelOption,
            {
              [currentValueOf(modelOption)]: response.configOptions ?? [],
              [opts.modelId]: configOptions,
            },
            isInternalAntigravityModelId,
          );
          if (models.length > 0) adapter.onAntigravityModels?.(models);
        }
      } else if (adapter) {
        throw new Error('ACP adapter did not advertise model configuration');
      } else {
        process.stderr.write(
          `Gemini ACP: no model configuration advertised; using the CLI default instead of ${opts.modelId}\n`,
        );
      }
      const thinkingOption = configOptions.find(isThoughtOption);
      const thinkingValues =
        thinkingOption === undefined ? undefined : selectOptionValues(thinkingOption);
      const thinkingValue =
        thinkingOption === undefined || thinkingValues === undefined
          ? undefined
          : opts.thinkingLevel !== undefined
            ? acpThoughtValue(opts.thinkingLevel, thinkingValues)
            : adapter?.harness === 'antigravity' &&
                opts.compactAt !== undefined &&
                (currentValueOf(thinkingOption) === 'high' ||
                  currentValueOf(thinkingOption) === 'xhigh') &&
                thinkingValues.has('medium')
              ? 'medium'
              : undefined;
      if (thinkingOption !== undefined && thinkingValue !== undefined) {
        await connection.agent.request(methods.agent.session.setConfigOption, {
          sessionId,
          configId: thinkingOption.id,
          value: thinkingValue,
        });
      }
      const modes = 'modes' in response ? response.modes : null;
      if (policy !== 'normal') {
        if (modes) {
          const target = restrictiveAcpMode(modes);
          if (target !== null) {
            await connection.agent.request(methods.agent.session.setMode, {
              sessionId,
              modeId: target,
            });
          }
        } else if (adapter?.harness === 'devin') {
          throw new Error(
            `${adapter.harness} ACP did not report its modes: refusing a locked turn (fail-closed)`,
          );
        }
      }
      if (adapter?.harness === 'devin' && policy === 'normal' && !isRestricted) {
        if (!modes?.availableModes.some((mode) => mode.id === 'bypass'))
          throw new Error('Devin ACP did not offer bypass mode for unattended steps');
        await connection.agent.request(methods.agent.session.setMode, {
          sessionId,
          modeId: 'bypass',
        });
      }
      if (adapter?.harness === 'antigravity') {
        const modes = 'modes' in response ? response.modes : null;
        if (modes !== null && modes !== undefined) {
          const preferred = !isRestricted
            ? (modes.availableModes.find((mode) => mode.id === 'auto') ??
              modes.availableModes.find((mode) => mode.id === 'accept-edits'))
            : (modes.availableModes.find((mode) => mode.id === 'default') ??
              modes.availableModes.find((mode) => mode.id === 'plan'));
          if (preferred !== undefined && modes.currentModeId !== preferred.id) {
            await connection.agent.request(methods.agent.session.setMode, {
              sessionId,
              modeId: preferred.id,
            });
          }
        }
      }
      const sessionPrompt =
        adapter?.harness === 'antigravity'
          ? validated.prompt
          : combinedSystemPrompt && validated.prompt !== undefined
            ? `${combinedSystemPrompt}\n\n${validated.prompt}`
            : validated.prompt;
      session = new AcpSession(
        sessionId,
        connection,
        sessionPrompt,
        (opts.promptImages ?? []).map((image) => ({ type: 'image', ...image })),
        caps?.promptCapabilities?.image === true,
        cleanup,
        adapter,
        opts.modelId,
        opts.compactAt,
        settleUnexpectedClose,
      );
      return session;
    } catch (error) {
      const recorded =
        acpErrorCode(error) !== undefined || error instanceof SessionNotResumableError
          ? null
          : await settleUnexpectedClose();
      cleanup();
      if (error instanceof SessionNotResumableError) throw error;
      const rawMessage = error instanceof Error ? error.message : String(error);
      const message = recorded !== null ? recorded.message : rawMessage;
      const mapped = adapter
        ? adapter.harness === 'antigravity'
          ? antigravityAcpErrorMessage(error, message)
          : message
        : acpErrorMessage(recorded !== null ? message : error);
      const finalMessage =
        recorded !== null || mapped !== message
          ? mapped
          : `ACP initialize failed (protocolVersion client=${PROTOCOL_VERSION}, agent=${agentVersion}): ${message}`;
      const isMissingBinary =
        /^Antigravity executable not found:|^Gemini executable not found:/.test(finalMessage) ||
        /spawn .*ENOENT/i.test(message);
      const isAuth =
        adapter?.harness === 'antigravity'
          ? isAntigravityAuthError(error, message) || isAntigravityAuthError(error, finalMessage)
          : !adapter && isGeminiAuthMessage(finalMessage);
      const direct = stepFailureOf(error);
      if (recorded !== null && recorded.code !== 'runtime_exited') {
        throw new StepFailureError(finalMessage, recorded.code, recorded.detail);
      }
      if (isMissingBinary) {
        throw new StepFailureError(finalMessage, 'missing_tool', {
          runtime,
          tool: boundedToolName(command),
        });
      }
      if (isAuth) {
        throw new StepFailureError(finalMessage, 'auth', { runtime });
      }
      if (recorded !== null) {
        throw new StepFailureError(finalMessage, recorded.code, recorded.detail);
      }
      if (direct !== null) {
        throw new StepFailureError(finalMessage, direct.failureCode, direct.failureDetail);
      }
      throw new Error(finalMessage);
    } finally {
      clearTimeout(initializeTimer);
    }
  }
}

export class GeminiBackend extends AcpBackend {}

export function createGeminiBackend(options?: GeminiBackendOptions): AgentBackend {
  return new GeminiBackend(options);
}

export interface AcpUpdateNormalization {
  update: SessionUpdate | null;
  parent?: string;
}

export interface AcpBackendOptions {
  harness: 'claude-code' | 'devin' | 'antigravity';
  command: string;
  args?: string[];
  resolveLaunch?: () => AcpResolvedLaunch | null;
  permissions?: 'deny' | 'allow-once';
  gate?: AcpGateOptions;
  steering?: 'mid-turn';
  sessionResume?: boolean;
  allowHostMcp?: boolean;
  usageEvents?: boolean;
  skills?: { skillsDir: string; cwd: string };
  onSkillsLog?: (msg: string) => void;
  onDevinModels?: (models: ModelSourceModel[]) => void;
  onAntigravityModels?: (models: ModelSourceModel[]) => void;
  createUpdateNormalizer?: () => (update: SessionUpdate) => AcpUpdateNormalization;
  initializeTimeoutMs?: number;
  cancelTimeoutMs?: number;
  acquireRuntime?: () => () => void;
  spawnProcess?: GeminiBackendOptions['spawnProcess'];
}

export function createAcpBackend(options: AcpBackendOptions): AgentBackend {
  return new AcpBackend({
    adapter: options,
    ...(options.gate ? { gate: options.gate } : {}),
    ...(options.spawnProcess ? { spawnProcess: options.spawnProcess } : {}),
  });
}
