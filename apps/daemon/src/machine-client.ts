import {
  type AgentTodoReport,
  type ClaimedStep,
  type ClaudeCodeReport,
  type MachineAskBody,
  type MachineAskResponse,
  type MachineAttachmentResponse,
  type MachineCapabilities,
  type MachineClaimBody,
  type MachineDoneBody,
  type MachineEnrollResponse,
  type MachineHeartbeatBody,
  type MachineRecord,
  type MachineRecoverResponse,
  type MachineSkillsManifestResponse,
  type MachineSteerResponse,
  type MachineStopResponse,
  type MachineStreamEvent,
  type MachineSyncResultBody,
  type MachineTokenResponse,
  machineAskResponseSchema,
  machineAttachmentResponseSchema,
  machineClaimResponseSchema,
  machineEnrollPollResponseSchema,
  machineEnrollResponseSchema,
  machineEnrollStartResponseSchema,
  machineOkResponseSchema,
  machineRecordSchema,
  machineRecoverResponseSchema,
  machineSkillsManifestResponseSchema,
  machineSteerResponseSchema,
  machineStopResponseSchema,
  machineStreamEventSchema,
  machineSyncResultResponseSchema,
  machineTokenResponseSchema,
  machineUploadUrlsResponseSchema,
  REMOTE_TOOL_RETRY_DELAYS_MS,
  REMOTE_TOOL_TIMEOUT_MS,
  type StepActivityReport,
  type StepRecord,
  type ToolCallRecord,
  type TranscriptRow,
  type TranscriptUpload,
} from '@cairn/shared';

export class MachineApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`machine api ${status}: ${body.slice(0, 200)}`);
    this.name = 'MachineApiError';
  }
}

export function isTransientUploadError(err: unknown): boolean {
  if (err instanceof MachineApiError) return err.status === 404 || err.status >= 500;
  return true;
}

export interface MachineClientOpts {
  serverUrl: string;
  getToken?: () => string;
  fetchImpl?: typeof fetch;
}

export interface MachineApi {
  enroll(body: {
    teamId: string;
    name?: string;
    cliVersion?: string;
    apiKey: string;
    claudeCode?: ClaudeCodeReport;
    capabilities?: MachineCapabilities;
  }): Promise<MachineEnrollResponse>;
  me(): Promise<MachineRecord>;
  presence(body: {
    cliVersion?: string;
    claudeCode?: ClaudeCodeReport;
    capabilities?: MachineCapabilities;
  }): Promise<void>;
  recover(): Promise<MachineRecoverResponse>;
  claim(signal?: AbortSignal, body?: MachineClaimBody): Promise<ClaimedStep | null>;
  heartbeat(stepId: string, body?: MachineHeartbeatBody): Promise<void>;
  tool(stepId: string, call: ToolCallRecord): Promise<void>;
  transcriptDelta(stepId: string, text: string): Promise<void>;
  thinkingDelta?(stepId: string, text: string): Promise<void>;
  transcriptRow?(stepId: string, row: TranscriptRow): Promise<void>;
  activity?(stepId: string, activity: StepActivityReport): Promise<void>;
  agentTodo?(stepId: string, todo: AgentTodoReport): Promise<void>;
  relayTool(
    stepId: string,
    name: string,
    params: Record<string, unknown>,
    opts?: { replaySafe?: boolean; signal?: AbortSignal },
  ): Promise<string>;
  askUser?(
    stepId: string,
    body: MachineAskBody,
    opts?: { signal?: AbortSignal },
  ): Promise<MachineAskResponse>;
  token(stepId: string): Promise<MachineTokenResponse>;
  skillsManifest(stepId: string): Promise<MachineSkillsManifestResponse>;
  skillFile(stepId: string, dirName: string, path: string): Promise<Buffer>;
  attachment(
    stepId: string,
    attachmentId: string,
    teamId: string,
  ): Promise<MachineAttachmentResponse>;
  uploadUrls(
    stepId: string,
    files: { name: string; size?: number }[],
  ): Promise<{
    uploads: { name: string; url: string; method: 'PUT'; headers: Record<string, string> }[];
  }>;
  putUpload(
    url: string,
    headers: Record<string, string>,
    body: TranscriptUpload | string,
    contentType?: string,
  ): Promise<void>;
  done(stepId: string, body: MachineDoneBody): Promise<void>;
  steer(stepId: string): Promise<string | null>;
  steerAck?(stepId: string): Promise<void>;
  stop(stepId: string): Promise<boolean | null>;
  syncResult(syncId: string, body: MachineSyncResultBody): Promise<void>;
  stream(
    signal: AbortSignal,
    onEvent: (ev: MachineStreamEvent) => void,
    onConnected?: () => void,
  ): Promise<void>;
}

export class MachineClient implements MachineApi {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: MachineClientOpts) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private url(path: string): string {
    return `${this.opts.serverUrl}${path}`;
  }

  private async request<T>(
    method: string,
    path: string,
    opts: {
      bearer?: string;
      body?: unknown;
      signal?: AbortSignal;
      parse?: (raw: unknown) => T;
      raw?: boolean;
    } = {},
  ): Promise<T> {
    const token = opts.bearer ?? this.opts.getToken?.();
    const headers: Record<string, string> = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    const res = await this.fetchImpl(this.url(path), {
      method,
      headers,
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    if (!res.ok) {
      throw new MachineApiError(res.status, await res.text());
    }
    const raw = (await res.json()) as unknown;
    return opts.parse ? opts.parse(raw) : (raw as T);
  }

  async enroll(body: {
    teamId: string;
    name?: string;
    cliVersion?: string;
    apiKey: string;
    claudeCode?: ClaudeCodeReport;
    capabilities?: MachineCapabilities;
  }): Promise<MachineEnrollResponse> {
    const { apiKey, ...rest } = body;
    return this.request<MachineEnrollResponse>('POST', '/api/machine/enroll', {
      bearer: apiKey,
      body: rest,
      parse: (raw) => machineEnrollResponseSchema.parse(raw),
    });
  }

  async enrollStart(body: { teamId?: string; name?: string }): Promise<{
    enrollId: string;
    url: string;
  }> {
    return this.request('POST', '/api/machine/enroll/start', {
      body,
      parse: (raw) =>
        machineEnrollStartResponseSchema.parse(raw) as { enrollId: string; url: string },
    });
  }

  async enrollPoll(
    enrollId: string,
  ): Promise<
    | { status: 'pending' }
    | { status: 'authorized'; machine: MachineEnrollResponse }
    | { status: 'expired' }
  > {
    return this.request('POST', '/api/machine/enroll/poll', {
      body: { enrollId },
      parse: (raw) => machineEnrollPollResponseSchema.parse(raw) as never,
    });
  }

  async me(): Promise<MachineRecord> {
    return this.request('GET', '/api/machine/me', {
      parse: (raw) => machineRecordSchema.parse(raw),
    });
  }

  async presence(body: {
    cliVersion?: string;
    claudeCode?: ClaudeCodeReport;
    capabilities?: MachineCapabilities;
  }): Promise<void> {
    await this.request('POST', '/api/machine/presence', {
      body,
      parse: (raw) => machineOkResponseSchema.parse(raw),
    });
  }

  async recover(): Promise<MachineRecoverResponse> {
    return this.request('POST', '/api/machine/recover', {
      body: {},
      parse: (raw) => machineRecoverResponseSchema.parse(raw),
    });
  }

  async claim(signal?: AbortSignal, body?: MachineClaimBody): Promise<ClaimedStep | null> {
    const res = await this.request<{ step: ClaimedStep | null }>(
      'POST',
      '/api/machine/tasks/claim',
      {
        body: body ?? {},
        signal,
        parse: (raw) => machineClaimResponseSchema.parse(raw) as { step: ClaimedStep | null },
      },
    );
    return res.step;
  }

  async heartbeat(stepId: string, body: MachineHeartbeatBody = {}): Promise<void> {
    await this.request('POST', `/api/machine/heartbeat/${stepId}`, {
      body,
      signal: AbortSignal.timeout(REMOTE_TOOL_TIMEOUT_MS),
      parse: (raw) => machineOkResponseSchema.parse(raw),
    });
  }

  async tool(stepId: string, call: ToolCallRecord): Promise<void> {
    await this.request('POST', `/api/machine/tool/${stepId}`, {
      body: call,
      parse: (raw) => machineOkResponseSchema.parse(raw),
    });
  }

  async transcriptDelta(stepId: string, text: string): Promise<void> {
    await this.request('POST', `/api/machine/tool/${stepId}`, {
      body: { kind: 'transcript_delta' as const, text },
      parse: (raw) => machineOkResponseSchema.parse(raw),
    });
  }

  async thinkingDelta(stepId: string, text: string): Promise<void> {
    await this.request('POST', `/api/machine/tool/${stepId}`, {
      body: { kind: 'thinking_delta' as const, text },
      parse: (raw) => machineOkResponseSchema.parse(raw),
    });
  }

  async transcriptRow(stepId: string, row: TranscriptRow): Promise<void> {
    await this.request('POST', `/api/machine/tool/${stepId}`, {
      body: { kind: 'transcript_row' as const, row },
      parse: (raw) => machineOkResponseSchema.parse(raw),
    });
  }

  async activity(stepId: string, activity: StepActivityReport): Promise<void> {
    await this.request('POST', `/api/machine/tool/${stepId}`, {
      body: { kind: 'activity' as const, activity },
      parse: (raw) => machineOkResponseSchema.parse(raw),
    });
  }

  async agentTodo(stepId: string, todo: AgentTodoReport): Promise<void> {
    await this.request('POST', `/api/machine/tool/${stepId}`, {
      body: { kind: 'agent_todo' as const, todo },
      parse: (raw) => machineOkResponseSchema.parse(raw),
    });
  }

  async relayTool(
    stepId: string,
    name: string,
    params: Record<string, unknown>,
    opts: { replaySafe?: boolean; signal?: AbortSignal } = {},
  ): Promise<string> {
    const replaySafe = opts.replaySafe ?? false;
    const delays = replaySafe ? [...REMOTE_TOOL_RETRY_DELAYS_MS] : [];
    let lastErr: unknown;
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      const timeout = AbortSignal.timeout(REMOTE_TOOL_TIMEOUT_MS);
      const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
      try {
        const res = await this.fetchImpl(this.url(`/api/machine/tool/${stepId}`), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(this.opts.getToken?.()
              ? { authorization: `Bearer ${this.opts.getToken?.()}` }
              : {}),
          },
          body: JSON.stringify({ name, params }),
          signal,
        });
        const body = (await res.json().catch(() => null)) as {
          text?: string;
          error?: string;
        } | null;
        if (res.ok) {
          return typeof body?.text === 'string' ? body.text : '';
        }
        const msg =
          typeof body?.error === 'string' ? body.error : `${name} failed (HTTP ${res.status})`;
        if (!replaySafe || res.status < 500) throw new MachineApiError(res.status, msg);
        lastErr = new MachineApiError(res.status, msg);
      } catch (err) {
        if (err instanceof MachineApiError && (!replaySafe || err.status < 500)) throw err;
        lastErr = err;
        if (!replaySafe) throw err;
      }
      const delay = delays[attempt];
      if (delay === undefined) break;
      await new Promise((r) => setTimeout(r, delay));
    }
    throw lastErr instanceof Error ? lastErr : new Error(`${name} relay failed`);
  }

  async token(stepId: string): Promise<MachineTokenResponse> {
    return this.request('GET', `/api/machine/token/${stepId}`, {
      parse: (raw) => machineTokenResponseSchema.parse(raw),
    });
  }

  async askUser(
    stepId: string,
    body: MachineAskBody,
    opts: { signal?: AbortSignal } = {},
  ): Promise<MachineAskResponse> {
    const HOLD_MS = 70_000;
    const REQUEST_TIMEOUT_MS = HOLD_MS + 15_000;
    for (;;) {
      const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
      const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
      try {
        const res = await this.fetchImpl(this.url(`/api/machine/ask/${stepId}`), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(this.opts.getToken?.()
              ? { authorization: `Bearer ${this.opts.getToken?.()}` }
              : {}),
          },
          body: JSON.stringify(body),
          signal,
        });
        if (!res.ok) {
          const raw = (await res.json().catch(() => null)) as { error?: unknown } | null;
          const msg =
            typeof raw?.error === 'string' ? raw.error : `ask_user failed (HTTP ${res.status})`;
          if (res.status < 500) throw new MachineApiError(res.status, msg);
          await new Promise((r) => setTimeout(r, 2_000));
          continue;
        }
        const settled = machineAskResponseSchema.parse(await res.json());
        if (settled.status !== 'pending') return settled;
      } catch (err) {
        if (err instanceof MachineApiError && err.status < 500) throw err;
        if (opts.signal?.aborted === true) throw err;
        await new Promise((r) => setTimeout(r, 2_000));
      }
    }
  }

  async skillsManifest(stepId: string): Promise<MachineSkillsManifestResponse> {
    return this.request('GET', `/api/machine/skills/${stepId}`, {
      parse: (raw) => machineSkillsManifestResponseSchema.parse(raw),
    });
  }

  async skillFile(stepId: string, dirName: string, path: string): Promise<Buffer> {
    const query = new URLSearchParams({ dirName, path });
    const url = this.url(`/api/machine/skills/${stepId}/file?${query.toString()}`);
    const delays = [...REMOTE_TOOL_RETRY_DELAYS_MS];
    let lastErr: unknown;
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        const token = this.opts.getToken?.();
        const res = await this.fetchImpl(url, {
          method: 'GET',
          ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
          signal: AbortSignal.timeout(REMOTE_TOOL_TIMEOUT_MS),
        });
        if (res.ok) return Buffer.from(await res.arrayBuffer());
        throw new MachineApiError(res.status, await res.text());
      } catch (err) {
        lastErr = err;
        if (err instanceof MachineApiError && err.status < 500) throw err;
      }
      const delay = delays[attempt];
      if (delay === undefined) break;
      await new Promise((r) => setTimeout(r, delay));
    }
    throw lastErr instanceof Error ? lastErr : new Error('skill file download failed');
  }

  async attachment(
    stepId: string,
    attachmentId: string,
    teamId: string,
  ): Promise<MachineAttachmentResponse> {
    const delays = [...REMOTE_TOOL_RETRY_DELAYS_MS];
    let lastErr: unknown;
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        return await this.request<MachineAttachmentResponse>(
          'GET',
          `/api/machine/attachment/${encodeURIComponent(stepId)}/${encodeURIComponent(attachmentId)}?teamId=${encodeURIComponent(teamId)}`,
          {
            signal: AbortSignal.timeout(REMOTE_TOOL_TIMEOUT_MS),
            parse: (raw) => machineAttachmentResponseSchema.parse(raw),
          },
        );
      } catch (err) {
        lastErr = err;
        if (err instanceof MachineApiError && err.status < 500) throw err;
      }
      const delay = delays[attempt];
      if (delay === undefined) break;
      await new Promise((r) => setTimeout(r, delay));
    }
    throw lastErr instanceof Error ? lastErr : new Error('attachment download failed');
  }

  async uploadUrls(
    stepId: string,
    files: { name: string; size?: number }[],
  ): Promise<{
    uploads: { name: string; url: string; method: 'PUT'; headers: Record<string, string> }[];
  }> {
    return this.request('POST', `/api/machine/upload-urls/${stepId}`, {
      body: { files },
      parse: (raw) => machineUploadUrlsResponseSchema.parse(raw) as never,
    });
  }

  async putUpload(
    url: string,
    headers: Record<string, string>,
    body: TranscriptUpload | string,
    contentType?: string,
  ): Promise<void> {
    const sameOrigin = new URL(url).origin === new URL(this.opts.serverUrl).origin;
    const token = sameOrigin ? this.opts.getToken?.() : undefined;
    const res = await this.fetchImpl(url, {
      method: 'PUT',
      headers: {
        'content-type': contentType ?? 'application/json',
        ...headers,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    if (!res.ok) throw new MachineApiError(res.status, await res.text());
    machineOkResponseSchema.parse(await res.json());
  }

  async done(stepId: string, body: MachineDoneBody): Promise<void> {
    await this.request('POST', `/api/machine/done/${stepId}`, {
      body,
      parse: (raw) => machineOkResponseSchema.parse(raw),
    });
  }

  async steer(stepId: string): Promise<string | null> {
    const res = await this.request<MachineSteerResponse>(
      'GET',
      `/api/machine/steer?stepId=${encodeURIComponent(stepId)}`,
      { parse: (raw) => machineSteerResponseSchema.parse(raw) },
    );
    return res.content;
  }

  async steerAck(stepId: string): Promise<void> {
    await this.request('POST', `/api/machine/steer/ack?stepId=${encodeURIComponent(stepId)}`, {
      parse: (raw) => machineOkResponseSchema.parse(raw),
    });
  }

  async stop(stepId: string): Promise<boolean | null> {
    const res = await this.request<MachineStopResponse>(
      'GET',
      `/api/machine/stop?stepId=${encodeURIComponent(stepId)}`,
      { parse: (raw) => machineStopResponseSchema.parse(raw) },
    );
    return res.discard;
  }

  async syncResult(syncId: string, body: MachineSyncResultBody): Promise<void> {
    await this.request('POST', `/api/machine/sync-result/${syncId}`, {
      body,
      parse: (raw) => machineSyncResultResponseSchema.parse(raw),
    });
  }

  async stream(
    signal: AbortSignal,
    onEvent: (ev: MachineStreamEvent) => void,
    onConnected?: () => void,
  ): Promise<void> {
    const token = this.opts.getToken?.();
    const res = await this.fetchImpl(this.url('/api/machine/stream'), {
      headers: {
        accept: 'text/event-stream',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      signal,
    });
    if (!res.ok || !res.body) throw new MachineApiError(res.status, 'stream unavailable');
    onConnected?.();
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buf += decoder.decode(value, { stream: true });
        let idx = buf.indexOf('\n\n');
        while (idx >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          for (const line of frame.split('\n')) {
            if (!line.startsWith('data:')) continue;
            onEvent(machineStreamEventSchema.parse(JSON.parse(line.slice(5).trim())));
          }
          idx = buf.indexOf('\n\n');
        }
      }
    } finally {
      void reader.cancel().catch(() => {});
    }
  }
}

export type { StepRecord };
