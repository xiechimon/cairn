// 机器面 HTTP 客户端——02 §5 词表 13 端点（wire schema 单源 = shared
// machine-wire.ts；响应逐字段过 zod parse = 客户端侧协议对拍）。
// HTTP 客户端纪律（01 §4.3）：内置 fetch + undici EnvHttpProxyAgent（proxy.ts）；
// 断网重试预算在 machine-loop（claim 指数退避封顶 30s，r3 §1.5）。

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
  type MachineShellPrecheckResponse,
  type MachineShellResultBody,
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
  machineShellPrecheckResponseSchema,
  machineShellResultResponseSchema,
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
} from '@pacman/shared';

export class MachineApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`machine api ${status}: ${body.slice(0, 200)}`);
    this.name = 'MachineApiError';
  }
}

/** 终稿回传（upload-urls → PUT）失败的瞬态判定（#1028）：404 = server 重启后
 * 旧预签名 URL 失效（重取即愈）、5xx / 网络 = 瞬时不可达——都值得重取 URL
 * 重传。其余 4xx（400/401/403/409…）= 语义拒绝（#1027 拒绝腿等），重试永不
 * 成功，直接上抛走 journal 残留。 */
export function isTransientUploadError(err: unknown): boolean {
  if (err instanceof MachineApiError) return err.status === 404 || err.status >= 500;
  return true; // 非协议错误（fetch 网络面）= 瞬态
}

export interface MachineClientOpts {
  serverUrl: string;
  /** 机器 token（machine.json）；enroll 时缺省。 */
  getToken?: () => string;
  fetchImpl?: typeof fetch;
}

/** 机器面客户端接口（测试注入用结构化类型；实现 = MachineClient）。 */
export interface MachineApi {
  enroll(body: {
    teamId: string;
    name?: string;
    cliVersion?: string;
    apiKey: string;
    claudeCode?: ClaudeCodeReport;
    /** 机器能力清单（#1251）：注册即上行，免等首个 presence 节拍。 */
    capabilities?: MachineCapabilities;
  }): Promise<MachineEnrollResponse>;
  me(): Promise<MachineRecord>;
  presence(body: {
    cliVersion?: string;
    claudeCode?: ClaudeCodeReport;
    capabilities?: MachineCapabilities;
  }): Promise<void>;
  recover(): Promise<MachineRecoverResponse>;
  /** claim 长轮询（server hold ~75s，r3 §1.5）；调用方给 signal 控制中断。
   * body = #1148 maxWorkers 自报（调用方传 effective cap）；缺省 = 空 body
   * （老 server / 测试桩兼容面）。 */
  claim(signal?: AbortSignal, body?: MachineClaimBody): Promise<ClaimedStep | null>;
  heartbeat(stepId: string, body?: MachineHeartbeatBody): Promise<void>;
  tool(stepId: string, call: ToolCallRecord): Promise<void>;
  /** live transcript 文本增量（machineToolBodySchema 第三形 [设计]，M5 live
   * streaming）：pi text_delta 节流批量转发，server 侧瞬态进 conversation
   * stream；失败不重试（终稿经 transcript 上传兜底）。 */
  transcriptDelta(stepId: string, text: string): Promise<void>;
  /** 思考增量（#1308，machineThinkingDeltaBodySchema）：与 transcriptDelta
   *  同节流同纪律，server 侧进会话流 thinking_delta，不落库。可选成员 =
   *  单测桩缺省不实现。 */
  thinkingDelta?(stepId: string, text: string): Promise<void>;
  /** 段行实时上报（machineToolBodySchema 第五形 [设计]，#955 / ADR 0011）：
   *  写入端封段后即时上报该行，server 先落库再广播；与终稿 upload-urls 按同
   *  id 幂等去重。可选成员 = 单测桩缺省不实现（与 activity 缺省同律）。 */
  transcriptRow?(stepId: string, row: TranscriptRow): Promise<void>;
  /** 步活动相位上报（machineToolBodySchema 第四形 [设计]，#905）：相位变化 /
   * 新流事件到达时节流重发，server 侧瞬态进 conversation stream activity
   * 事件；失败不重试（活动是呈现信号，丢了下一拍会再来）。可选成员 =
   * 单测桩缺省不实现（与 sessionHandles 缺省同律）。 */
  activity?(stepId: string, activity: StepActivityReport): Promise<void>;
  agentTodo?(stepId: string, todo: AgentTodoReport): Promise<void>;
  /** remoteTools relay 执行（chief 步服务端工具）：POST tool/{stepId}
   * {name, params} → {text}（r5 §3.1 bundle）。replaySafe → 重试预算
   * REMOTE_TOOL_RETRY_DELAYS_MS；超时 REMOTE_TOOL_TIMEOUT_MS。返回结果文本。 */
  relayTool(
    stepId: string,
    name: string,
    params: Record<string, unknown>,
    opts?: { replaySafe?: boolean; signal?: AbortSignal },
  ): Promise<string>;
  /** 结构化问答阻塞通道（#1049）：POST /api/machine/ask/{stepId}
   * {requestId, questions} → 终态（answered/cancelled）才 resolve；hold 到期
   * 仍 pending = 同 requestId 原样重发（幂等，重投不叠卡——D4）。网络层瞬断
   * 不终结等待（重试预算同 replaySafe 族）；server 4xx 单次即抛。可选成员 =
   * 单测桩缺省不实现（与 transcriptRow/activity 同律）——缺席时 runner 拦截
   * 面回落 relayTool（旧 daemon 等价行为，卡片照建不阻塞）。 */
  askUser?(
    stepId: string,
    body: MachineAskBody,
    opts?: { signal?: AbortSignal },
  ): Promise<MachineAskResponse>;
  token(stepId: string): Promise<MachineTokenResponse>;
  /** 按步技能分发清单（XMON-109 S1 端点，#920 清单 + 按需拉 / S2 消费）：
   * worker 步 = agent.skills 白名单交集（selection='whitelist'），chief 步 =
   * 信任面全量（selection='all'）；非本步凭证/未知步 = 404。失败抛错——
   * runner 按 failed 收尾（旧 fail-open「仅本机技能」降级已退役，#920：
   * 分发失败必须显式可观测，不许静默跑空）。 */
  skillsManifest(stepId: string): Promise<MachineSkillsManifestResponse>;
  /** 技能单文件按需拉取（#920）：GET /api/machine/skills/{stepId}/file
   * ?dirName=&path= → 原始字节（sha256/sizeBytes 校验在物化器）。幂等 GET
   * 带 attachment 同款重试预算：网络/5xx 按 REMOTE_TOOL_RETRY_DELAYS_MS
   * 重试、4xx 单次即抛。 */
  skillFile(stepId: string, dirName: string, path: string): Promise<Buffer>;
  /** 图片附件下载（#730）：GET /api/machine/attachment/{stepId}/{attachmentId}
   * → {fileName, mimeType, sizeBytes, contentBase64}。replaySafe 读面带
   * REMOTE_TOOL_RETRY_DELAYS_MS 重试预算（幂等 GET）；4xx = 协议事实
   * （pending 409 / 未知 404 / 跨 team 404）单次即抛——调用方按「不可用
   * 注记」处理，步不崩。 */
  attachment(stepId: string, attachmentId: string): Promise<MachineAttachmentResponse>;
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
  /** steer 拉取-确认（W3 #279，06 册 D9）：{content} = 运行中步的补话文本
   * （拉取即确认，server 侧 pending 随即清）；null = 无待取/非本机在跑步/
   * pending 定向旧步（已丢弃）。 */
  steer(stepId: string): Promise<string | null>;
  /** stop 拉取-确认（M7 #308）：{discard} = 运行中步的停止请求（拉取即
   * 确认；discard = 「丢弃本轮修改」勾选位，true → rewind 到步起点
   * checkpoint）；null = 无待取/非本机在跑步/pending 定向旧步（已丢弃）。 */
  stop(stepId: string): Promise<boolean | null>;
  /** sync 状态回写（M7 #319，08 册附录 B「分支同步」daemon 端）：状态机过渡
   * running/synced/failed 三值（M7 syncResultBodySchema）；终态只可写一次
   * （server transition 函数守面）。失败抛错由上层 catch——不回滚已落 sync
   * 状态，仅日志报警 [设计]。 */
  syncResult(syncId: string, body: MachineSyncResultBody): Promise<void>;
  /** machine shell 每命令预检（XMON-108 R1 / XMON-110 R2）：
   * POST /api/machine/shell/{stepId}。200 → {allowed, runId}（schema 对拍）；
   * 403 → MachineApiError（body = server {error} 原因原文，denied 审计行已
   * 落库）；其余非 2xx / 网络错误原样抛。**不重试**——预检非幂等（server 每
   * 调用落一行审计，重试丢响应 = 孤儿 running 行）；失败面由 shell-channel
   * 按「预检失败」口径回报 agent。超时 REMOTE_TOOL_TIMEOUT_MS。 */
  shellPrecheck(stepId: string, command: string): Promise<MachineShellPrecheckResponse>;
  /** machine shell 执行终态回写：POST /api/machine/shell/{runId}/result。
   * server 终态幂等（重复回写 = 200 不改写）→ 5xx/网络错误按
   * REMOTE_TOOL_RETRY_DELAYS_MS 重试（重放安全）；4xx（409 denied 行 /
   * 404 / 403 跨机）= 协议错，单次即抛。 */
  shellResult(runId: string, body: MachineShellResultBody): Promise<void>;
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

  // —— enroll（02 §5.2 路径二：apiKey Bearer）———————————————————————————————

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

  // —— 机器面（token Bearer）———————————————————————————————————————————————

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

  /** claim 长轮询（server hold ~75s，r3 §1.5）；调用方给 signal 控制中断。
   * #1148：body 携 maxWorkers（worker 并发上限自报，server 闸取 min）；缺
   * 省 = 空 body（老 server 形）。 */
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

  /** remoteTools relay（r5 §3.1 bundle `remoteTools.ts` 语义）：replaySafe 读工具
   * 带重试预算 [500,2000]ms + 10s 超时；写工具（非 replaySafe）单次不重试。
   * 服务端拒绝（4xx {error}）→ 抛错由上层转 pi 工具结果文本；成功 → text。 */
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
        // 服务端拒绝（非瞬态）→ 不重试，抛 {error} 供上层落工具结果。
        const msg =
          typeof body?.error === 'string' ? body.error : `${name} failed (HTTP ${res.status})`;
        if (!replaySafe || res.status < 500) throw new MachineApiError(res.status, msg);
        lastErr = new MachineApiError(res.status, msg); // 5xx + replaySafe → 重试
      } catch (err) {
        if (err instanceof MachineApiError && (!replaySafe || err.status < 500)) throw err;
        lastErr = err; // 超时/网络（replaySafe）→ 重试
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

  /** 问答阻塞通道（#1049）：循环到终态。每轮 = 一次 hold 长轮询（server ~70s
   * 返回 pending 时重发同 requestId——幂等命中既有卡）；请求超时 = hold + 15s
   * 余量（连接挂死不当成「server 说 pending」）；网络/5xx 无限重试（D3 的
   * daemon 半边：等答期间任何瞬断都不终结等待），server 4xx 抛错。signal 是
   * 唯一退出面（runner 停止/收线）。 */
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
          // 5xx → 稍歇重发（同 requestId 幂等）。
          await new Promise((r) => setTimeout(r, 2_000));
          continue;
        }
        const settled = machineAskResponseSchema.parse(await res.json());
        if (settled.status !== 'pending') return settled;
      } catch (err) {
        if (err instanceof MachineApiError && err.status < 500) throw err;
        if (opts.signal?.aborted === true) throw err;
        // 网络瞬断/超时 → 稍歇重发；等待不因瞬断终结（signal 除外）。
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
    // 幂等 GET（attachment 同族）：网络/5xx 按预算重试；4xx = 协议事实
    // （清单外/白名单外 404）单次即抛。响应 = 原始字节，非 JSON。
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

  async attachment(stepId: string, attachmentId: string): Promise<MachineAttachmentResponse> {
    // 幂等 GET（relayTool replaySafe 同族）：网络/5xx 按预算重试；4xx 单次抛。
    const delays = [...REMOTE_TOOL_RETRY_DELAYS_MS];
    let lastErr: unknown;
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        return await this.request<MachineAttachmentResponse>(
          'GET',
          `/api/machine/attachment/${stepId}/${attachmentId}`,
          {
            signal: AbortSignal.timeout(REMOTE_TOOL_TIMEOUT_MS),
            parse: (raw) => machineAttachmentResponseSchema.parse(raw),
          },
        );
      } catch (err) {
        lastErr = err;
        if (err instanceof MachineApiError && err.status < 500) throw err;
        if (err instanceof MachineApiError) {
          // 5xx → 重试
        }
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

  /** 预签名 PUT（绝对 URL；一次性）。机器 token 仅同源附带（预签名 URL 若
   * 指向异源存储，不得外泄 Bearer [设计]）。body 双形：transcript.json =
   * JSON；plan.md = 原文 text/markdown（02 §4.2 plan 即文件）。 */
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

  /** steer 拉取-确认（W3 #279）：GET /api/machine/steer?stepId=（[设计]
   * MACHINE_WIRE_EXTENSIONS 登记位；本机在跑步单槽 pending）。 */
  async steer(stepId: string): Promise<string | null> {
    const res = await this.request<MachineSteerResponse>(
      'GET',
      `/api/machine/steer?stepId=${encodeURIComponent(stepId)}`,
      { parse: (raw) => machineSteerResponseSchema.parse(raw) },
    );
    return res.content;
  }

  /** stop 拉取-确认（M7 #308）：GET /api/machine/stop?stepId=（[设计]
   * MACHINE_WIRE_EXTENSIONS 登记位；本机在跑步单槽 pending，steer 同形）。 */
  async stop(stepId: string): Promise<boolean | null> {
    const res = await this.request<MachineStopResponse>(
      'GET',
      `/api/machine/stop?stepId=${encodeURIComponent(stepId)}`,
      { parse: (raw) => machineStopResponseSchema.parse(raw) },
    );
    return res.discard;
  }

  /** sync 状态回写（M7 #319）：POST /api/machine/sync-result/{syncId} =
   * machine-wire MACHINE_WIRE_EXTENSIONS 登记位；daemon 在 running 起步 +
   * synced/failed 收尾两时刻回写，server 侧 transition 函数负责状态机守面 + 推
   * team stream branch_sync 事件给 web 实时结果卡。 */
  async syncResult(syncId: string, body: MachineSyncResultBody): Promise<void> {
    await this.request('POST', `/api/machine/sync-result/${syncId}`, {
      body,
      parse: (raw) => machineSyncResultResponseSchema.parse(raw),
    });
  }

  async shellPrecheck(stepId: string, command: string): Promise<MachineShellPrecheckResponse> {
    const token = this.opts.getToken?.();
    const res = await this.fetchImpl(this.url(`/api/machine/shell/${stepId}`), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ command }),
      signal: AbortSignal.timeout(REMOTE_TOOL_TIMEOUT_MS),
    });
    const raw = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) {
      // 403 的 {error} = 双闸拒绝原因原文（shell-channel 直接回报 agent）；
      // 其余非 2xx 无原因字段时按状态码兜底。
      const msg =
        typeof raw?.error === 'string' ? raw.error : `shell precheck failed (HTTP ${res.status})`;
      throw new MachineApiError(res.status, msg);
    }
    return machineShellPrecheckResponseSchema.parse(raw);
  }

  async shellResult(runId: string, body: MachineShellResultBody): Promise<void> {
    // 重试预算 = relayTool replaySafe 同族：server 终态幂等（XMON-108 R1
    // 「重复回写 = 幂等 200 不改写」）使网络重试/丢响应重放安全；4xx 是协议
    // 事实（denied 行 409 / runId 404 / 跨机 403），重试只会重复同一拒绝。
    const delays = [...REMOTE_TOOL_RETRY_DELAYS_MS];
    let lastErr: unknown;
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        const token = this.opts.getToken?.();
        const res = await this.fetchImpl(this.url(`/api/machine/shell/${runId}/result`), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(REMOTE_TOOL_TIMEOUT_MS),
        });
        if (res.ok) {
          machineShellResultResponseSchema.parse(await res.json().catch(() => null));
          return;
        }
        const err = new MachineApiError(res.status, await res.text());
        if (res.status < 500) throw err;
        lastErr = err;
      } catch (err) {
        if (err instanceof MachineApiError && err.status < 500) throw err;
        lastErr = err;
      }
      const delay = delays[attempt];
      if (delay === undefined) break;
      await new Promise((r) => setTimeout(r, delay));
    }
    throw lastErr instanceof Error ? lastErr : new Error('shell result writeback failed');
  }

  /** wake SSE（02 §1.2 机器通道）：帧解析回调；连接断开自然返回。 */
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
