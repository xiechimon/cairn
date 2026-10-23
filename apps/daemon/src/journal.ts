// 步骤 journal + outbox（02 §5.3/§5.4；recover 细节 [推断]——04 册附录 A
// 「自定等价物（形状对即可）」口径的落地：per-step JSON 文件 + transcript
// 缓冲文件落 outbox/，重启后经 POST /api/machine/recover 与 server 真值对账，
// claimed 未收尾步以 continue session 续跑（00/D3：durable 语义宿主自持）。

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ClaimedStep, MachineDoneBody, StepKind, TranscriptUpload } from '@cairn/shared';
import type { StopRequest } from './step-stops.js';

export type JournalState = 'claimed' | 'running' | 'awaiting-upload' | 'done' | 'failed';

export interface StepJournalEntry {
  stepId: string;
  buildId: string;
  kind: StepKind;
  conversationId: string;
  state: JournalState;
  sessionAction: 'new' | 'continue';
  /** pi 会话标识（session 建立后即写入——崩溃 recover 的 continue 解析键）。 */
  sessionId: string | null;
  /** 本轮任务文本（recover 续跑重发用）。 */
  prompt: string | null;
  /** claim 载荷快照（非密文面；recover 续跑的 todo/agent 上下文——宿主
   * durable 编排自持，00/D3）。 */
  claimed: ClaimedStep | null;
  /** #1026 终稿快照（awaiting-upload 残留的 recover 快路径素材）：上传/done
   * 失败前落 journal——恢复时重传产物 + 补报 done body，不重跑 agent 轮。
   * null/缺省（含旧格式条目）= 未到快照点，recover 走整步重跑原路径。 */
  doneBody?: MachineDoneBody | null;
  /** 同上快照的 plan 半（plan 步收尾时的 plan.md 原文；非 plan 步/无产物 =
   * null——快路径无 plan 上传行）。 */
  planContent?: string | null;
  /** 已接收的停止请求（deliverStop 拉取-确认后落盘）。重启后 recover 据此报
   * stopped、不重跑；缺省 = 没收到停止。 */
  stopRequest?: StopRequest | null;
  claimedAt: number;
  updatedAt: number;
}

export type TranscriptMessage = TranscriptUpload['messages'][number];

export class StepJournal {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private file(stepId: string): string {
    return join(this.dir, `step-${stepId}.json`);
  }

  claim(
    input: Omit<StepJournalEntry, 'state' | 'claimedAt' | 'updatedAt' | 'sessionId' | 'claimed'> & {
      sessionId?: string | null;
      claimed?: ClaimedStep | null;
    },
  ): StepJournalEntry {
    const now = Date.now();
    const entry: StepJournalEntry = {
      ...input,
      sessionId: input.sessionId ?? null,
      claimed: input.claimed ?? null,
      state: 'claimed',
      claimedAt: now,
      updatedAt: now,
    };
    this.write(entry);
    return entry;
  }

  update(
    stepId: string,
    patch: Partial<Omit<StepJournalEntry, 'stepId'>>,
  ): StepJournalEntry | null {
    const entry = this.get(stepId);
    if (!entry) return null;
    const next = { ...entry, ...patch, stepId, updatedAt: Date.now() };
    this.write(next);
    return next;
  }

  get(stepId: string): StepJournalEntry | null {
    if (!existsSync(this.file(stepId))) return null;
    try {
      return JSON.parse(readFileSync(this.file(stepId), 'utf8')) as StepJournalEntry;
    } catch {
      return null;
    }
  }

  /** claimed/running/awaiting-upload = pending（recover 面，r3 §1.5
   * `[recover] no pending steps found` 的对偶）。 */
  pending(): StepJournalEntry[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((f) => f.startsWith('step-') && f.endsWith('.json'))
      .map((f) => {
        try {
          return JSON.parse(readFileSync(join(this.dir, f), 'utf8')) as StepJournalEntry;
        } catch {
          return null;
        }
      })
      .filter((e): e is StepJournalEntry => e !== null)
      .filter(
        (e) => e.state === 'claimed' || e.state === 'running' || e.state === 'awaiting-upload',
      )
      .sort((a, b) => a.claimedAt - b.claimedAt);
  }

  remove(stepId: string): void {
    if (existsSync(this.file(stepId))) rmSync(this.file(stepId));
  }

  private write(entry: StepJournalEntry): void {
    writeFileSync(this.file(entry.stepId), `${JSON.stringify(entry, null, 2)}\n`, 'utf8');
  }
}

/** transcript 缓冲（upload-urls 终稿回传源，02 §1.3）：id 幂等 upsert——
 * tool live 回传（tool/<stepId>）与终稿同 id 去重 [设计]。 */
export class TranscriptBuffer {
  private readonly file: string;
  private readonly rows = new Map<string, TranscriptMessage>();

  constructor(dir: string, stepId: string) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, `step-${stepId}.transcript.json`);
    if (existsSync(this.file)) {
      try {
        const raw = JSON.parse(readFileSync(this.file, 'utf8')) as TranscriptMessage[];
        for (const m of raw) this.rows.set(m.id, m);
      } catch {
        // 损坏缓冲 = 从空重建（transcript 终稿以引擎会话为准可再生 [设计]）。
      }
    }
  }

  upsert(msg: TranscriptMessage): void {
    this.rows.set(msg.id, msg);
    this.flush();
  }

  messages(): TranscriptMessage[] {
    return [...this.rows.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  private flush(): void {
    writeFileSync(this.file, `${JSON.stringify(this.messages(), null, 2)}\n`, 'utf8');
  }
}
