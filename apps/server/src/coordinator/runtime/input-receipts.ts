import { coordinatorConversationKey, parseCoordinatorConversationKey } from '@cairn/shared';
import type { Context } from '@earendil-works/chord/context';
import {
  type ConversationId,
  type Harness,
  LiveDoc,
  type LiveState,
  type SubmissionId,
  type SubmissionRecord,
} from '@earendil-works/pi-durable';
import { InputAuthorityError, type InputChannel } from './input-channel.js';

export function createInputReceipts(
  threadId: string,
  channel: InputChannel,
  context: Context,
  report: (error: unknown) => void,
) {
  type Work =
    | { kind: 'receipt'; record: SubmissionRecord }
    | {
        kind: 'run';
        conversationId: ConversationId;
        taskId: string;
        inputs: readonly SubmissionId[];
      };
  const pending: Work[] = [];
  const submissions = new Map<SubmissionId, SubmissionRecord>();
  const queuedRuns = new Set<string>();
  let currentHarness: Harness | null = null;
  let storeId: string | undefined;
  const key = (conversationId: string) => {
    if (storeId === undefined)
      throw new InputAuthorityError('Coordinator receipts are not attached to a store');
    return coordinatorConversationKey(storeId, conversationId);
  };
  const nativeId = (conversationId: string): ConversationId => {
    if (storeId === undefined)
      throw new InputAuthorityError('Coordinator receipts are not attached to a store');
    const parsed = parseCoordinatorConversationKey(conversationId);
    if (parsed?.storeId !== storeId)
      throw new Error('Coordinator input belongs to another durable store');
    return Number(parsed.conversationId) as ConversationId;
  };
  const enqueueRun = (conversationId: ConversationId, live: Readonly<LiveState>) => {
    const run = live.run ?? live.runFailure;
    if (run === undefined || run.inputs.length === 0) return;
    const runKey = `${conversationId}:${run.taskId}:${run.inputs.join(',')}`;
    if (queuedRuns.has(runKey)) return;
    queuedRuns.add(runKey);
    pending.push({
      kind: 'run',
      conversationId,
      taskId: String(run.taskId),
      inputs: [...run.inputs],
    });
  };
  let stopping = false;
  let draining: Promise<void> | null = null;
  let detach: (() => void) | null = null;

  const flush = async () => {
    while (pending.length > 0) {
      const work = pending[0];
      if (work === undefined) break;
      if (work.kind === 'receipt') {
        const record = work.record;
        if (record.requestId !== undefined && record.type === 'input') {
          if (record.entry !== undefined)
            await channel.consume(
              record.requestId,
              key(String(record.conversationId)),
              String(record.entry),
            );
          else if (record.status === 'unanswered')
            await channel.release(record.requestId, key(String(record.conversationId)));
        }
      } else {
        if (currentHarness === null) throw new Error('Coordinator run binding has no harness');
        const harness = currentHarness;
        const records = await Promise.all(
          work.inputs.map(async (id) => {
            const stored = submissions.get(id);
            if (stored !== undefined) return stored;
            const submission = await harness.submission(id, context);
            const record = await submission?.status(context);
            if (record !== undefined) submissions.set(id, record);
            return record;
          }),
        );
        const requests = records.flatMap((record) =>
          record?.type === 'input' &&
          record.requestId !== undefined &&
          record.conversationId === work.conversationId &&
          record.entry !== undefined
            ? [record.requestId]
            : [],
        );
        if (requests.length !== work.inputs.length)
          throw new InputAuthorityError('Coordinator run contains an unknown input');
        await channel.bindRun(threadId, key(String(work.conversationId)), work.taskId, requests);
      }
      pending.shift();
    }
  };

  const barrier = async (signal?: AbortSignal): Promise<void> => {
    for (;;) {
      signal?.throwIfAborted();
      if (stopping) throw new Error('Coordinator receipt drain is stopping');
      if (draining === null) {
        draining = flush().finally(() => {
          draining = null;
        });
      }
      try {
        await draining;
        if (pending.length === 0) return;
      } catch (error) {
        report(error);
        if (stopping || error instanceof InputAuthorityError) throw error;
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      }
    }
  };

  return {
    barrier,
    key,
    storeId: () => storeId,
    attach(harness: Harness, identity: string) {
      if (storeId !== identity) {
        if (pending.length > 0)
          throw new InputAuthorityError('Cannot replace a store with pending receipts');
        submissions.clear();
        queuedRuns.clear();
      }
      storeId = identity;
      detach?.();
      currentHarness = harness;
      const observer = harness.observeCommits({
        advance(publication) {
          for (const change of publication.changes) {
            if (change.type === 'submission') submissions.set(change.value.id, change.value);
          }
          for (const change of publication.changes) {
            if (
              change.type === 'submission' &&
              change.value.type === 'input' &&
              change.value.status !== 'queued'
            )
              pending.push({ kind: 'receipt', record: change.value });
          }
          for (const change of publication.changes) {
            if (
              change.type === 'document' &&
              change.kind === 'change' &&
              change.record.kind === 'pi.live' &&
              change.conversationId !== undefined
            )
              enqueueRun(change.conversationId, change.value as LiveState);
          }
        },
        end() {},
      });
      detach = () => observer.detach();
    },
    async recover(harness: Harness) {
      const position = await channel.position(threadId);
      if (position !== null && (storeId === undefined || position.storeId === storeId)) {
        for (const target of await channel.targets(threadId)) {
          const conversationId = Number(position.conversationId) as ConversationId;
          const conversationKey = key(position.conversationId);
          if (
            (await channel.list(threadId)).some(
              (input) =>
                input.stepId === target.id &&
                input.kind === 'initial' &&
                input.conversationId === conversationKey,
            )
          )
            continue;
          const record = await harness.commit(
            (tx) => tx.submissionByRequest(conversationId, target.id),
            context,
          );
          if (record?.type !== 'input') continue;
          const entryId = record.entry;
          const entry =
            entryId === undefined
              ? undefined
              : await harness.commit((tx) => tx.entry(entryId), context);
          const message = entry?.model?.[0];
          const content =
            message?.role === 'user' && typeof message.content === 'string'
              ? message.content
              : target.content;
          await channel.prepare(
            target.id,
            conversationKey,
            content,
            record.entry === undefined ? 'unplaced' : String(record.entry),
          );
          submissions.set(record.id, record);
          pending.push({ kind: 'receipt', record });
        }
      }
      for (const batch of await channel.list(threadId)) {
        if (batch.state !== 'pending') continue;
        if (batch.conversationId === null) {
          if (!batch.live) await channel.release(batch.id, null);
          continue;
        }
        const conversationId = nativeId(batch.conversationId);
        const conversation = await harness.conversation(conversationId, context);
        if (conversation === undefined)
          throw new Error(`Coordinator receipt conversation missing for ${batch.id}`);
        let record = await harness.commit(
          (tx) => tx.submissionByRequest(conversationId, batch.id),
          context,
        );
        if (record?.entry === undefined && !batch.live && record !== undefined) {
          const submission = await harness.submission(record.id, context);
          await submission?.abort(context);
          record = await harness.commit(
            (tx) => tx.submissionByRequest(conversationId, batch.id),
            context,
          );
        }
        if (record !== undefined) {
          submissions.set(record.id, record);
          pending.push({ kind: 'receipt', record });
        } else if (!batch.live) await channel.release(batch.id, batch.conversationId);
      }
      const conversations = new Set(
        (await channel.list(threadId)).flatMap((input) =>
          input.conversationId === null ||
          (storeId !== undefined &&
            parseCoordinatorConversationKey(input.conversationId)?.storeId !== storeId)
            ? []
            : [input.conversationId],
        ),
      );
      for (const id of conversations) {
        const live = await harness.snapshot(LiveDoc, nativeId(id), context);
        if (live !== undefined) enqueueRun(nativeId(id), live);
      }
      await barrier();
    },
    stop() {
      stopping = true;
    },
    async close() {
      stopping = true;
      await draining?.catch(() => {});
      try {
        await flush();
      } finally {
        detach?.();
        detach = null;
      }
    },
  };
}

export type InputReceipts = ReturnType<typeof createInputReceipts>;
