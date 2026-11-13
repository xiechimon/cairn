import { type AgentTodoReporter, parseAgentTodoText } from './agent-todo.js';
import { DeltaRelay } from './delta-relay.js';
import type { TranscriptBuffer } from './journal.js';
import type { MachineApi } from './machine-client.js';
import { type SealedSegment, SegmentEmitter, segmentContent } from './segment.js';

const TRANSCRIPT_DELTA_FLUSH_MS = 250;

export interface StepTranscriptStreamOptions {
  stepId: string;
  client: MachineApi;
  transcript: Pick<TranscriptBuffer, 'upsert'>;
  agentTodo: Pick<AgentTodoReporter, 'report'>;
  now: () => number;
  log: (line: string) => void;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class StepTranscriptStream {
  readonly segments: SegmentEmitter;
  private readonly textDeltas: DeltaRelay;
  private readonly thinkingDeltas: DeltaRelay;
  private messageSeq = 0;
  private lastRowCreatedAt = 0;

  constructor(private readonly options: StepTranscriptStreamOptions) {
    const { client, stepId, log } = options;
    this.textDeltas = new DeltaRelay({
      flushMs: TRANSCRIPT_DELTA_FLUSH_MS,
      send: (text) => client.transcriptDelta(stepId, text),
      onError: (err) => log(`transcript delta relay failed: ${errorText(err)}`),
    });
    this.thinkingDeltas = new DeltaRelay({
      flushMs: TRANSCRIPT_DELTA_FLUSH_MS,
      send: (text) => client.thinkingDelta?.(stepId, text),
      onError: (err) => log(`thinking delta relay failed: ${errorText(err)}`),
    });
    this.segments = new SegmentEmitter((seg) => this.emitSegment(seg));
  }

  rowCreatedAt(): number {
    this.lastRowCreatedAt = Math.max(this.options.now(), this.lastRowCreatedAt + 1);
    return this.lastRowCreatedAt;
  }

  nextMessageId(): string {
    this.messageSeq += 1;
    return `msg-${this.options.stepId}-${this.messageSeq}`;
  }

  pushText(text: string): void {
    this.textDeltas.push(text);
  }

  pushThinking(text: string): void {
    this.thinkingDeltas.push(text);
  }

  discardDeltas(): void {
    this.thinkingDeltas.discard();
    this.textDeltas.discard();
  }

  flushDeltas(): void {
    this.textDeltas.flush();
    this.thinkingDeltas.flush();
  }

  private async emitSegment(seg: SealedSegment): Promise<void> {
    const { client, stepId, transcript, agentTodo, log } = this.options;
    await this.thinkingDeltas.flushNow();
    await this.textDeltas.flushNow();
    const row = {
      id: this.nextMessageId(),
      role: 'assistant' as const,
      content: segmentContent(seg),
      createdAt: this.rowCreatedAt(),
    };
    transcript.upsert(row);
    try {
      await client.transcriptRow?.(stepId, row);
    } catch (err: unknown) {
      log(`segment row relay failed: ${errorText(err)}`);
    }
    if (seg.kind === 'text') {
      const items = parseAgentTodoText(seg.text);
      if (items !== null) agentTodo.report(items);
    }
  }
}
