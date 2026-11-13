import { randomUUID } from 'node:crypto';
import type { AnswerDeliveryVia, MachineAskBody } from '@cairn/shared';
import type { MachineApi } from './machine-client.js';

export const ASK_KEEP_ALIVE_INTERVAL_MS = 30_000;

export interface AskChannelOptions {
  client: Pick<MachineApi, 'askUser' | 'steerAck'>;
  stepId: string;
  log: (message: string) => void;
}

export class AskChannel {
  keepAlive: (() => void) | null = null;
  private readonly abortController = new AbortController();
  private readonly answeredPolls = new Set<string>();

  constructor(private readonly options: AskChannelOptions) {}

  get available(): boolean {
    return this.options.client.askUser !== undefined;
  }

  abort(): void {
    this.abortController.abort();
  }

  async ask(params: Record<string, unknown>): Promise<string> {
    const { client, stepId } = this.options;
    if (client.askUser === undefined) throw new Error('ask channel unavailable');
    const requestId = `ask-${randomUUID()}`;
    const keepAliveTimer = setInterval(() => this.keepAlive?.(), ASK_KEEP_ALIVE_INTERVAL_MS);
    keepAliveTimer.unref?.();
    try {
      const response = await client.askUser(
        stepId,
        {
          requestId,
          questions: (params.questions ?? []) as MachineAskBody['questions'],
          ...(typeof params.provenance === 'string' ? { provenance: params.provenance } : {}),
        },
        { signal: this.abortController.signal },
      );
      if (response.status === 'answered' && !this.abortController.signal.aborted) {
        this.answeredPolls.add(requestId);
      }
      return JSON.stringify(response);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return JSON.stringify({
        status: 'cancelled',
        requestId,
        answers: null,
        reason: `ask channel aborted: ${msg}`,
      });
    } finally {
      clearInterval(keepAliveTimer);
    }
  }

  async ackAnswers(answerIds: readonly string[], via: AnswerDeliveryVia): Promise<void> {
    if (answerIds.length === 0) return;
    await this.options.client
      .steerAck?.(this.options.stepId, { answerIds: [...answerIds], via })
      .catch((err: unknown) => {
        this.options.log(`answer ack failed: ${err instanceof Error ? err.message : String(err)}`);
      });
  }

  async ackPollsReachedBy(toolResult: unknown): Promise<void> {
    if (this.answeredPolls.size === 0) return;
    const result = JSON.stringify(toolResult);
    const reached = [...this.answeredPolls].filter((id) => result.includes(id));
    for (const id of reached) this.answeredPolls.delete(id);
    await this.ackAnswers(reached, 'poll');
  }
}
