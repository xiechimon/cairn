import {
  type AgentTodoReport,
  ATTACHMENT_MAX_BYTES,
  type BackgroundTask,
  type ClaimedStep,
  type ClaudeCodeReport,
  type ClaudeRateLimitReport,
  type MachineAntigravityModelProbeResult,
  type MachineAntigravityVerifyBody,
  type MachineAskBody,
  type MachineAskResponse,
  type MachineAttachmentResponse,
  type MachineCapabilities,
  type MachineClaimBody,
  type MachineComputerFramesBody,
  type MachineComputerFramesResponse,
  type MachineDoneBody,
  type MachineEnrollResponse,
  type MachineHeartbeatBody,
  type MachineImEventBody,
  type MachineLocalMergeRecheckBody,
  type MachineLocalMergeRecheckResponse,
  type MachineOfflineBody,
  type MachineOfflineResponse,
  type MachinePresenceBody,
  type MachinePresenceResponse,
  type MachineRecord,
  type MachineRecoverResponse,
  type MachineSkillsManifestResponse,
  type MachineSteerAckBody,
  type MachineSteerResponse,
  type MachineStopResponse,
  type MachineStreamEvent,
  type MachineTokenResponse,
  type MachineUploadUrlsResponse,
  machineAntigravityModelProbeCredentialSchema,
  machineAskResponseSchema,
  machineAttachmentResponseSchema,
  machineClaimResponseSchema,
  machineComputerFramesResponseSchema,
  machineEnrollPollResponseSchema,
  machineEnrollResponseSchema,
  machineEnrollStartResponseSchema,
  machineLocalMergeRecheckResponseSchema,
  machineOfflineResponseSchema,
  machineOkResponseSchema,
  machinePresenceResponseSchema,
  machineRecordSchema,
  machineRecoverResponseSchema,
  machineSkillsManifestResponseSchema,
  machineSteerResponseSchema,
  machineStopResponseSchema,
  machineStreamEventSchema,
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

export class RelayToolError extends MachineApiError {
  constructor(status: number, body: string) {
    super(status, body);
    this.message = `machine api ${status}: ${body}`;
    this.name = 'RelayToolError';
  }
}

export function isTransientUploadError(err: unknown): boolean {
  if (err instanceof MachineApiError) return err.status === 404 || err.status >= 500;
  return true;
}

const KNOWN_STREAM_EVENT_TYPES: ReadonlySet<string> = new Set(
  machineStreamEventSchema.options.map((option) => option.shape.type.value),
);

function hasKnownStreamEventType(raw: unknown): boolean {
  if (raw === null || typeof raw !== 'object') return false;
  const type = (raw as { type?: unknown }).type;
  return typeof type === 'string' && KNOWN_STREAM_EVENT_TYPES.has(type);
}

export interface MachineClientOpts {
  serverUrl: string;
  getToken?: () => string;
  fetchImpl?: typeof fetch;
  claim?: Readonly<{ stepId: string; generation: number | undefined }>;
}

export interface MachineApi {
  enroll(body: {
    teamId: string;
    name?: string;
    cliVersion?: string;
    apiKey: string;
    claudeCode?: ClaudeCodeReport;
    capabilities?: MachineCapabilities;
    hostKey?: string;
    legacyHostKeys?: string[];
  }): Promise<MachineEnrollResponse>;
  me(): Promise<MachineRecord>;
  presence(body: MachinePresenceBody, signal?: AbortSignal): Promise<MachinePresenceResponse>;
  offline?(body: MachineOfflineBody, signal?: AbortSignal): Promise<MachineOfflineResponse>;
  recover(): Promise<MachineRecoverResponse>;
  claim(signal?: AbortSignal, body?: MachineClaimBody): Promise<ClaimedStep | null>;
  heartbeat(stepId: string, body?: MachineHeartbeatBody): Promise<void>;
  localMergeRecheck?(
    stepId: string,
    body: MachineLocalMergeRecheckBody,
  ): Promise<MachineLocalMergeRecheckResponse>;
  tool(stepId: string, call: ToolCallRecord): Promise<void>;
  transcriptDelta(stepId: string, text: string): Promise<void>;
  thinkingDelta?(stepId: string, text: string): Promise<void>;
  transcriptRow?(stepId: string, row: TranscriptRow): Promise<void>;
  activity?(stepId: string, activity: StepActivityReport): Promise<void>;
  agentTodo?(stepId: string, todo: AgentTodoReport): Promise<void>;
  backgroundTask?(stepId: string, task: BackgroundTask): Promise<void>;
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
  token(
    stepId: string,
    generation?: number,
    opts?: { refresh?: boolean },
  ): Promise<MachineTokenResponse>;
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
    body: TranscriptUpload | string | Buffer,
    contentType?: string,
  ): Promise<void>;
  done(stepId: string, body: MachineDoneBody): Promise<void>;
  reportClaudeRateLimit?(body: ClaudeRateLimitReport): Promise<void>;
  claimAntigravityModelProbe?(
    requestId: string,
    connectionId: string,
    signal: AbortSignal,
  ): Promise<string>;
  finishAntigravityModelProbe?(
    requestId: string,
    connectionId: string,
    result: MachineAntigravityModelProbeResult,
    signal: AbortSignal,
  ): Promise<void>;
  reportAntigravityVerify?(body: MachineAntigravityVerifyBody, signal?: AbortSignal): Promise<void>;
  steer(stepId: string): Promise<MachineSteerResponse | null>;
  steerAck?(stepId: string, body?: MachineSteerAckBody): Promise<void>;
  stop(stepId: string): Promise<boolean | null>;
  computerFrames?(
    callId: string,
    body: MachineComputerFramesBody,
    signal?: AbortSignal,
  ): Promise<MachineComputerFramesResponse>;
  downloadComputerAttachment?(callId: string, signal?: AbortSignal): Promise<Buffer>;
  uploadComputerAttachment?(
    callId: string,
    input: { fileName: string; caption?: string; bytes: Buffer },
    signal?: AbortSignal,
  ): Promise<{ id: string; key: string; token: string; sha256: string }>;
  imEvent?(connId: string, body: MachineImEventBody): Promise<void>;
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

  forClaim(stepId: string, generation: number | undefined): MachineClient {
    if (
      this.opts.claim !== undefined &&
      (this.opts.claim.stepId !== stepId || this.opts.claim.generation !== generation)
    )
      throw new Error('Machine client is already bound to another claim');
    return new MachineClient({ ...this.opts, claim: { stepId, generation } });
  }

  private url(path: string): string {
    const url = new URL(path, this.opts.serverUrl);
    const claim = this.opts.claim;
    if (claim !== undefined) {
      const stepId =
        /^\/api\/machine\/(?:heartbeat|tool|ask|token|skills|attachment|upload-urls|session|local-merge-recheck|done)\/([^/]+)/.exec(
          url.pathname,
        )?.[1] ?? url.searchParams.get('stepId');
      if (stepId !== null && stepId !== undefined && decodeURIComponent(stepId) !== claim.stepId)
        throw new Error('Machine request does not match its claim');
      url.searchParams.delete('generation');
      if (claim.generation !== undefined)
        url.searchParams.set('generation', String(claim.generation));
    }
    return url.toString();
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
    hostKey?: string;
    legacyHostKeys?: string[];
  }): Promise<MachineEnrollResponse> {
    const { apiKey, ...rest } = body;
    return this.request<MachineEnrollResponse>('POST', '/api/machine/enroll', {
      bearer: apiKey,
      body: rest,
      parse: (raw) => machineEnrollResponseSchema.parse(raw),
    });
  }

  async enrollStart(body: {
    teamId?: string;
    name?: string;
    hostKey?: string;
    legacyHostKeys?: string[];
  }): Promise<{
    enrollId: string;
    url: string;
    code?: string;
  }> {
    return this.request('POST', '/api/machine/enroll/start', {
      body,
      parse: (raw) => machineEnrollStartResponseSchema.parse(raw),
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

  async presence(
    body: MachinePresenceBody,
    signal?: AbortSignal,
  ): Promise<MachinePresenceResponse> {
    return this.request('POST', '/api/machine/presence', {
      body,
      signal,
      parse: (raw) => machinePresenceResponseSchema.parse(raw),
    });
  }

  async offline(body: MachineOfflineBody, signal?: AbortSignal): Promise<MachineOfflineResponse> {
    return this.request('POST', '/api/machine/offline', {
      body,
      signal,
      parse: (raw) => machineOfflineResponseSchema.parse(raw),
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
        body: { ...body, verifyAttachments: true },
        signal,
        parse: (raw) => machineClaimResponseSchema.parse(raw) as { step: ClaimedStep | null },
      },
    );
    return res.step;
  }

  async claimAntigravityModelProbe(
    requestId: string,
    connectionId: string,
    signal: AbortSignal,
  ): Promise<string> {
    const credential = await this.request(
      'POST',
      `/api/machine/antigravity/model-probes/${encodeURIComponent(requestId)}`,
      {
        body: { phase: 'claim', connectionId },
        signal,
        parse: (raw) => machineAntigravityModelProbeCredentialSchema.parse(raw),
      },
    );
    return credential.token;
  }

  async finishAntigravityModelProbe(
    requestId: string,
    connectionId: string,
    result: MachineAntigravityModelProbeResult,
    signal: AbortSignal,
  ): Promise<void> {
    await this.request(
      'POST',
      `/api/machine/antigravity/model-probes/${encodeURIComponent(requestId)}`,
      {
        body: { phase: 'result', connectionId, result },
        signal,
        parse: (raw) => machineOkResponseSchema.parse(raw),
      },
    );
  }

  async heartbeat(stepId: string, body: MachineHeartbeatBody = {}): Promise<void> {
    await this.request('POST', `/api/machine/heartbeat/${stepId}`, {
      body,
      signal: AbortSignal.timeout(REMOTE_TOOL_TIMEOUT_MS),
      parse: (raw) => machineOkResponseSchema.parse(raw),
    });
  }

  async localMergeRecheck(
    stepId: string,
    body: MachineLocalMergeRecheckBody,
  ): Promise<MachineLocalMergeRecheckResponse> {
    const delays = [...REMOTE_TOOL_RETRY_DELAYS_MS];
    let lastErr: unknown;
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        return await this.request<MachineLocalMergeRecheckResponse>(
          'POST',
          `/api/machine/local-merge-recheck/${stepId}`,
          {
            body,
            signal: AbortSignal.timeout(REMOTE_TOOL_TIMEOUT_MS),
            parse: (raw) => machineLocalMergeRecheckResponseSchema.parse(raw),
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
    throw lastErr instanceof Error ? lastErr : new Error('local merge recheck failed');
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

  async backgroundTask(stepId: string, task: BackgroundTask): Promise<void> {
    await this.request('POST', `/api/machine/tool/${stepId}`, {
      body: { kind: 'bg_task' as const, task },
      parse: (raw) => machineOkResponseSchema.parse(raw),
    });
  }

  async relayTool(
    stepId: string,
    name: string,
    params: Record<string, unknown>,
    opts: {
      replaySafe?: boolean;
      signal?: AbortSignal;
      toolCallId?: string;
      timeoutMs?: number;
    } = {},
  ): Promise<string> {
    const replaySafe = opts.replaySafe ?? false;
    const delays = replaySafe ? [...REMOTE_TOOL_RETRY_DELAYS_MS] : [];
    let lastErr: unknown;
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      const timeout = AbortSignal.timeout(opts.timeoutMs ?? REMOTE_TOOL_TIMEOUT_MS);
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
          body: JSON.stringify({
            name,
            params,
            ...(opts.toolCallId !== undefined ? { toolCallId: opts.toolCallId } : {}),
          }),
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
        if (!replaySafe || res.status < 500) throw new RelayToolError(res.status, msg);
        lastErr = new RelayToolError(res.status, msg);
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

  async token(
    stepId: string,
    generation?: number,
    opts: { refresh?: boolean } = {},
  ): Promise<MachineTokenResponse> {
    const query = [
      generation == null ? '' : `generation=${generation}`,
      opts.refresh === true ? 'refresh=1' : '',
    ]
      .filter((part) => part !== '')
      .join('&');
    return this.request('GET', `/api/machine/token/${stepId}${query === '' ? '' : `?${query}`}`, {
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
  ): Promise<MachineUploadUrlsResponse> {
    return this.request('POST', `/api/machine/upload-urls/${stepId}`, {
      body: { files },
      parse: (raw) => machineUploadUrlsResponseSchema.parse(raw),
    });
  }

  async putUpload(
    url: string,
    headers: Record<string, string>,
    body: TranscriptUpload | string | Buffer,
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
      body: Buffer.isBuffer(body) ? body : typeof body === 'string' ? body : JSON.stringify(body),
    });
    if (!res.ok) throw new MachineApiError(res.status, await res.text());
    machineOkResponseSchema.parse(await res.json());
  }

  async done(stepId: string, body: MachineDoneBody): Promise<void> {
    await this.request('POST', `/api/machine/done/${stepId}`, {
      body:
        this.opts.claim === undefined ? body : { ...body, generation: this.opts.claim.generation },
      parse: (raw) => machineOkResponseSchema.parse(raw),
    });
  }

  async reportClaudeRateLimit(body: ClaudeRateLimitReport): Promise<void> {
    await this.request('POST', '/api/machine/rate-limit', {
      body,
      parse: (raw) => machineOkResponseSchema.parse(raw),
    });
  }

  async reportAntigravityVerify(
    body: MachineAntigravityVerifyBody,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.request('POST', '/api/machine/antigravity/verify', {
      body,
      signal: signal ?? AbortSignal.timeout(REMOTE_TOOL_TIMEOUT_MS),
      parse: (raw) => machineOkResponseSchema.parse(raw),
    });
  }

  async steer(stepId: string): Promise<MachineSteerResponse> {
    return this.request<MachineSteerResponse>(
      'GET',
      `/api/machine/steer?stepId=${encodeURIComponent(stepId)}&batches=1`,
      { parse: (raw) => machineSteerResponseSchema.parse(raw) },
    );
  }

  async steerAck(stepId: string, body?: MachineSteerAckBody): Promise<void> {
    await this.request('POST', `/api/machine/steer/ack?stepId=${encodeURIComponent(stepId)}`, {
      ...(body !== undefined ? { body } : {}),
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

  async computerFrames(
    callId: string,
    body: MachineComputerFramesBody,
    signal?: AbortSignal,
  ): Promise<MachineComputerFramesResponse> {
    return this.request('POST', `/api/machine/computer/${callId}`, {
      body,
      signal,
      parse: (raw) => machineComputerFramesResponseSchema.parse(raw),
    });
  }

  async downloadComputerAttachment(callId: string, signal?: AbortSignal): Promise<Buffer> {
    const token = this.opts.getToken?.();
    const res = await this.fetchImpl(this.url(`/api/machine/computer/${callId}/attachment`), {
      method: 'GET',
      ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) throw new MachineApiError(res.status, await res.text());
    const declared = Number(res.headers.get('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > ATTACHMENT_MAX_BYTES) {
      throw new MachineApiError(413, 'attachment exceeds the 10 MiB limit');
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.byteLength > ATTACHMENT_MAX_BYTES) {
      throw new MachineApiError(413, 'attachment exceeds the 10 MiB limit');
    }
    return bytes;
  }

  async uploadComputerAttachment(
    callId: string,
    input: { fileName: string; caption?: string; bytes: Buffer },
    signal?: AbortSignal,
  ): Promise<{ id: string; key: string; token: string; sha256: string }> {
    const token = this.opts.getToken?.();
    const encodedCaption =
      input.caption !== undefined ? encodeURIComponent(input.caption.slice(0, 500)) : undefined;
    const headers: Record<string, string> = {
      'content-type': 'application/octet-stream',
      'x-cairn-filename': encodeURIComponent(input.fileName),
      ...(encodedCaption !== undefined ? { 'x-cairn-caption': encodedCaption } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    };
    const res = await this.fetchImpl(this.url(`/api/machine/computer/${callId}/attachment`), {
      method: 'POST',
      headers,
      body: new Uint8Array(input.bytes),
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) throw new MachineApiError(res.status, await res.text());
    return (await res.json()) as { id: string; key: string; token: string; sha256: string };
  }

  async imEvent(connId: string, body: MachineImEventBody): Promise<void> {
    await this.request('POST', `/api/machine/im/${encodeURIComponent(connId)}/event`, {
      body,
      parse: (raw) => machineOkResponseSchema.parse(raw),
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
            const raw: unknown = JSON.parse(line.slice(5).trim());
            const parsed = machineStreamEventSchema.safeParse(raw);
            if (parsed.success) onEvent(parsed.data);
            else if (hasKnownStreamEventType(raw)) throw parsed.error;
          }
          idx = buf.indexOf('\n\n');
        }
      }
    } finally {
      void reader.cancel().catch(() => {});
    }
  }
}

export function bindMachineClaim(
  client: MachineApi,
  stepId: string,
  generation: number | undefined,
): MachineApi {
  return client instanceof MachineClient ? client.forClaim(stepId, generation) : client;
}

export type { StepRecord };
