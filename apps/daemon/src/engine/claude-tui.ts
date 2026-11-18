import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AgentBackend,
  AgentSessionHandle,
  AgentTokenUsage,
  BriefChannel,
  ModelUsage,
  SessionOpts,
  StepEvent,
} from '@cairn/shared';
import { z } from 'zod';
import type { ClaudeCodeBackendOpts } from '../backend/claude-code.js';
import {
  buildSkillDenyRules,
  claudeSessionEnv,
  createClaudeMapState,
  HOST_MCP_SERVER_NAME,
  mapClaudeMessage,
  mapMcpEndpoint,
  resolveTeamSkillsPluginDir,
  sdkTranscriptPath,
  toUsageRows,
} from '../backend/claude-code.js';
import { SessionNotResumableError } from '../backend/errors.js';
import { EventQueue } from '../backend/event-queue.js';
import { claudeCliEnv } from '../backend/otel.js';
import { withoutPinnedEnv } from '../backend/pinned-env.js';
import { collectDeniedSkillDirs } from '../backend/skills.js';
import { EnginePty } from './engine-pty.js';
import { type HostMcpBridge, openHostMcpBridge } from './host-mcp.js';
import { openEnginePtyProcess } from './pty.js';
import { registerEnginePty } from './registry.js';

const SDK_ASK_TOOL = 'AskUserQuestion';
const SDK_WRITE_TOOLS = ['Edit', 'Write'];
const HOST_BUILTIN_TOOLS = ['Read', 'Glob', 'Grep'];
const HOST_ALLOWED_TOOLS = [`mcp__${HOST_MCP_SERVER_NAME}`, ...HOST_BUILTIN_TOOLS];
const METERED_CLAUDE_AUTH_BLANK = {
  ANTHROPIC_API_KEY: '',
  ANTHROPIC_AUTH_TOKEN: '',
  CLAUDE_CODE_USE_BEDROCK: '',
  CLAUDE_CODE_USE_VERTEX: '',
  CLAUDE_CODE_USE_FOUNDRY: '',
};
const EFFORT_LEVELS: readonly string[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const OAUTH_TOKEN_FD = 3;
const TAIL_POLL_MS = 250;

export interface ClaudePtyBackendOpts extends ClaudeCodeBackendOpts {
  runtimeDir?: string;
  log?: (msg: string) => void;
}

export function createClaudePtyBackend(
  inner: AgentBackend,
  opts: ClaudePtyBackendOpts,
): AgentBackend {
  return new ClaudePtyBackend(inner, opts);
}

class ClaudePtyBackend implements AgentBackend {
  readonly capabilities: AgentBackend['capabilities'];
  readonly brief: BriefChannel | undefined;

  constructor(
    private readonly inner: AgentBackend,
    private readonly opts: ClaudePtyBackendOpts,
  ) {
    this.capabilities = inner.capabilities;
    this.brief = inner.brief;
  }

  createSession(session: SessionOpts): Promise<AgentSessionHandle> {
    return this.open(session, null);
  }

  continueSession(id: string, session: SessionOpts): Promise<AgentSessionHandle> {
    if (!existsSync(sdkTranscriptPath(session.cwd, id))) {
      return Promise.reject(new SessionNotResumableError(id));
    }
    return this.open(session, id);
  }

  adaptProviderCompat(
    provider: Parameters<NonNullable<AgentBackend['adaptProviderCompat']>>[0],
    errorMessage: string,
  ) {
    return this.inner.adaptProviderCompat?.(provider, errorMessage) ?? null;
  }

  modelSupportsImages(
    provider: Parameters<NonNullable<AgentBackend['modelSupportsImages']>>[0],
    modelId: string,
  ) {
    return this.inner.modelSupportsImages?.(provider, modelId) ?? Promise.resolve(null);
  }

  rememberNoVision(
    provider: Parameters<NonNullable<AgentBackend['rememberNoVision']>>[0],
    modelId: string,
  ): void {
    this.inner.rememberNoVision?.(provider, modelId);
  }

  describeImage(
    provider: Parameters<NonNullable<AgentBackend['describeImage']>>[0],
    image: Parameters<NonNullable<AgentBackend['describeImage']>>[1],
  ) {
    return this.inner.describeImage?.(provider, image) ?? Promise.resolve(undefined);
  }

  private async open(session: SessionOpts, resumeId: string | null): Promise<AgentSessionHandle> {
    if (!ptyEligible(session, this.opts)) return this.pipe(session, resumeId);
    const sessionEnv = claudeSessionEnv(session);
    const stepToken = sessionEnv?.CLAUDE_CODE_OAUTH_TOKEN;
    const env = claudeCliEnv({
      ...withoutPinnedEnv(process.env),
      ...sessionEnv,
      ...(stepToken !== undefined ? METERED_CLAUDE_AUTH_BLANK : {}),
    });
    delete env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB;
    delete env.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR;
    if (stepToken !== undefined) {
      delete env.CLAUDE_CODE_OAUTH_TOKEN;
      env.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR = String(OAUTH_TOKEN_FD);
    }
    const locked = session.lockedDown === true;
    const denied = collectDeniedSkillDirs(this.opts.skills, session);
    const skillDenyRules = buildSkillDenyRules(denied);
    if (denied.length > 0) {
      this.opts.onSkillsLog?.(`deny: ${denied.length} skill dir(s) hard-blocked`);
    }
    const pluginDir = resolveTeamSkillsPluginDir({
      skills: this.opts.skills,
      cacheRoot: this.opts.teamSkillsCacheDir,
      executableVersion: this.opts.executableVersion,
      session,
      ...(this.opts.onSkillsLog !== undefined ? { log: this.opts.onSkillsLog } : {}),
    });
    const sessionId = resumeId ?? randomUUID();
    const bridge = await openHostMcpBridge({
      dir: join(this.opts.runtimeDir ?? session.cwd, '.cairn-engine', sessionId),
      remoteTools: session.remoteTools ?? [],
      ...(session.executeRemoteTool !== undefined ? { relay: session.executeRemoteTool } : {}),
      localTools: session.localTools ?? [],
    });
    try {
      return await this.spawn(
        session,
        resumeId,
        sessionId,
        env,
        locked,
        skillDenyRules,
        pluginDir,
        bridge,
        stepToken,
      );
    } catch (error) {
      bridge?.close();
      throw error;
    }
  }

  private async pipe(session: SessionOpts, resumeId: string | null): Promise<AgentSessionHandle> {
    return resumeId === null
      ? this.inner.createSession(session)
      : this.inner.continueSession(resumeId, session);
  }

  private async spawn(
    session: SessionOpts,
    resumeId: string | null,
    sessionId: string,
    env: Record<string, string>,
    locked: boolean,
    skillDenyRules: string[],
    pluginDir: string | null,
    bridge: HostMcpBridge | null,
    fdToken: string | undefined,
  ): Promise<AgentSessionHandle> {
    const mcpServers: Record<string, unknown> = {};
    if (bridge !== null) {
      mcpServers[HOST_MCP_SERVER_NAME] = {
        type: 'stdio',
        command: bridge.command[0],
        args: [...bridge.command.slice(1)],
        env: { ...bridge.env },
      };
    }
    if (!locked) {
      for (const endpoint of session.mcpServers ?? []) {
        if (endpoint.slug === HOST_MCP_SERVER_NAME) {
          throw new Error(`mcp server slug '${endpoint.slug}' collides with the host tool server`);
        }
        mcpServers[endpoint.slug] = mapMcpEndpoint(endpoint);
      }
    }
    const managedMcp = session.mcpServers !== undefined;
    const workDir = join(this.opts.runtimeDir ?? session.cwd, '.cairn-engine', sessionId);
    mkdirSync(workDir, { recursive: true, mode: 0o700 });
    const settings: Record<string, unknown> = {
      env: claudeCliEnv({}),
      ...(locked ? { disableAllHooks: true, disableSkillShellExecution: true } : {}),
      ...(skillDenyRules.length > 0 ? { permissions: { deny: skillDenyRules } } : {}),
    };
    const disallowedTools = [SDK_ASK_TOOL, ...(session.readOnly === true ? SDK_WRITE_TOOLS : [])];
    const args: string[] = [];
    args.push('--model', session.modelId);
    const effort = toEffort(session.thinkingLevel);
    if (effort !== undefined) args.push('--effort', effort);
    if (locked || session.remoteToolsOnly === true) {
      args.push('--permission-mode', 'dontAsk');
      const allowed =
        session.remoteToolsOnly === true
          ? [`mcp__${HOST_MCP_SERVER_NAME}`]
          : [...HOST_ALLOWED_TOOLS];
      args.push('--allowedTools', allowed.join(' '));
      args.push('--disallowedTools', [...disallowedTools, 'Bash'].join(' '));
      args.push('--setting-sources', 'project');
      args.push('--strict-mcp-config');
    } else {
      args.push('--dangerously-skip-permissions');
      if (disallowedTools.length > 0) args.push('--disallowedTools', disallowedTools.join(' '));
      args.push('--setting-sources', 'user,project,local');
      if (managedMcp) args.push('--strict-mcp-config');
    }
    if (session.systemPrompt !== undefined) {
      args.push('--append-system-prompt', session.systemPrompt);
    }
    if (Object.keys(mcpServers).length > 0) {
      const mcpPath = join(workDir, 'mcp.json');
      writeFileSync(mcpPath, JSON.stringify({ mcpServers }), { mode: 0o600 });
      args.push('--mcp-config', mcpPath);
    }
    const settingsPath = join(workDir, 'settings.json');
    writeFileSync(settingsPath, JSON.stringify(settings), { mode: 0o600 });
    args.push('--settings', settingsPath);
    if (pluginDir !== null && session.remoteToolsOnly !== true) {
      args.push('--plugin-dir', pluginDir);
    }
    if (resumeId !== null) args.push('--resume', resumeId);
    else args.push('--session-id', sessionId);
    if (session.prompt !== undefined) args.push(session.prompt);
    const command = [this.opts.executablePath ?? 'claude', ...args];
    this.opts.log?.(`engine pty spawn: ${command[0]} (${resumeId === null ? 'new' : 'resume'})`);
    const proc = openEnginePtyProcess(command, {
      cwd: session.cwd,
      env,
      ...(fdToken !== undefined ? { fdToken } : {}),
    });
    const pty = new EnginePty(proc, {
      secrets: () => session.secrets?.() ?? [],
      onExit: () => handle.onProcessExit(),
    });
    const handle = new TuiSessionHandle(
      { sessionId, cwd: session.cwd, modelId: session.modelId },
      pty,
      () => {
        bridge?.close();
      },
    );
    registerEnginePty(handle, pty);
    return handle;
  }
}

function ptyEligible(session: SessionOpts, opts: ClaudePtyBackendOpts): boolean {
  if (opts.inOrb === true) return false;
  if (session.promptImages !== undefined && session.promptImages.length > 0) return false;
  if (process.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB === '1') return false;
  return true;
}

function toEffort(level: string | undefined): string | undefined {
  if (level === undefined || level === 'off' || level === 'minimal') return undefined;
  if (EFFORT_LEVELS.includes(level)) return level;
  throw new Error(`claude pty backend: unsupported thinkingLevel '${level}'`);
}

const jsonlRowSchema = z.object({
  type: z.string().optional(),
  isSidechain: z.boolean().optional(),
  parent_tool_use_id: z.string().nullable().optional(),
});

interface TailMessage {
  message?: {
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_creation?: {
        ephemeral_5m_input_tokens?: number;
        ephemeral_1h_input_tokens?: number;
      };
    };
    stop_reason?: string | null;
    model?: string;
  };
}

class TuiSessionHandle implements AgentSessionHandle {
  readonly sessionId: string;
  readonly sessionFile: string;
  readonly events: AsyncIterable<StepEvent>;
  private readonly queue = new EventQueue();
  private usageRows: ModelUsage[] = [];
  private offset = 0;
  private tail = '';
  private timer: NodeJS.Timeout | null = null;
  private done = false;
  private stopping = false;
  private readonly cwd: string;
  private readonly modelId: string;
  private readonly state;

  constructor(
    opts: { sessionId: string; cwd: string; modelId: string },
    private readonly pty: EnginePty,
    private readonly onClose: () => void,
  ) {
    this.sessionId = opts.sessionId;
    this.sessionFile = sdkTranscriptPath(opts.cwd, opts.sessionId);
    this.events = this.queue.iterable();
    this.modelId = opts.modelId;
    this.cwd = opts.cwd;
    this.state = createClaudeMapState({ modelId: opts.modelId });
    this.timer = setInterval(() => this.pumpTail(), TAIL_POLL_MS);
    this.timer.unref();
  }

  steer(text: string, images?: readonly { data: string; mimeType: string }[]): Promise<void> {
    if (images !== undefined && images.length > 0) {
      return Promise.reject(new Error('image steers are not supported on engine pty sessions'));
    }
    return this.pty.writeAgent(`${text}\r`);
  }

  async stop(): Promise<void> {
    if (this.done) return;
    this.stopping = true;
    this.pty.interrupt();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 1500);
      timer.unref();
    });
    this.finish();
  }

  usage(): AgentTokenUsage {
    return this.usageRows;
  }

  onProcessExit(): void {
    this.pumpTail();
    if (this.done) return;
    if (this.stopping) {
      this.finish();
      return;
    }
    this.queue.push({
      type: 'error',
      error: {
        message: 'engine exited before finishing',
        retryable: false,
        processCrash: true,
      },
    });
    this.finish();
  }

  private pumpTail(): void {
    if (this.done) return;
    let text: string;
    try {
      const stat = readFileSync(this.sessionFile);
      text = stat.toString('utf8', this.offset);
      this.offset = stat.length;
    } catch {
      return;
    }
    this.tail += text;
    let idx = this.tail.indexOf('\n');
    while (idx >= 0) {
      const line = this.tail.slice(0, idx);
      this.tail = this.tail.slice(idx + 1);
      idx = this.tail.indexOf('\n');
      this.handleLine(line);
      if (this.done) return;
    }
  }

  private handleLine(line: string): void {
    if (line.trim() === '') return;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      return;
    }
    const meta = jsonlRowSchema.safeParse(raw);
    if (!meta.success) return;
    if (meta.data.isSidechain === true) return;
    const events = mapClaudeMessage(raw as Parameters<typeof mapClaudeMessage>[0], this.state);
    for (const event of events) this.queue.push(event);
    const msg = (raw as TailMessage).message;
    if (meta.data.type === 'assistant' && meta.data.parent_tool_use_id == null) {
      if (msg?.usage !== undefined) {
        this.usageRows = toUsageRows({ usage: msg.usage }, this.modelId);
      }
      const stop = msg?.stop_reason;
      if (stop === 'end_turn' || stop === 'stop_sequence') {
        this.queue.push({ type: 'done', usage: this.usageRows });
        this.finish();
      } else if (stop === 'max_tokens' || stop === 'refusal') {
        this.queue.push({
          type: 'error',
          error: { message: `engine turn ended: ${stop}`, retryable: false },
        });
        this.finish();
      }
    }
  }

  private finish(): void {
    if (this.done) return;
    this.done = true;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.queue.end();
    this.pty.close();
    this.onClose();
  }
}
