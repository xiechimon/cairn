import { coordinatorConversationKey } from '@cairn/shared';
import type { Context } from '@earendil-works/chord/context';
import {
  AssistantEntry,
  CompactionEntry,
  type ConversationId,
  type Cursor,
  type EntryRecord,
  GenerationTask,
  type Harness,
  ResetEntry,
  SystemEntry,
  type TaskId,
  ToolResultEntry,
  ToolTask,
  type Tx,
  UserEntry,
} from '@earendil-works/pi-durable';
import { parseWatermark } from '../watermark.js';
import { InputAuthorityError, type InputChannel } from './input-channel.js';
import type { MachineApi } from './machine-api.js';
import { entryRowSources } from './mirror.js';

export async function replayCoordinatorInputs(
  harness: Harness,
  channel: InputChannel,
  api: Pick<MachineApi, 'transcriptRow'>,
  threadId: string,
  storeId: string,
  context: Context,
  pageSize = 500,
): Promise<void> {
  const position = await channel.position(threadId);
  if (position?.storeId !== storeId) return;
  const watermark = parseWatermark(position.lastMirroredEntryId);
  if (watermark?.kind === 'rewind') return;
  const conversationKey = coordinatorConversationKey(storeId, position.conversationId);
  const inputs = (await channel.list(threadId)).filter(
    (input) =>
      input.conversationId === conversationKey &&
      input.state === 'consumed' &&
      input.entryId !== null,
  );
  if (inputs.length === 0) return;
  const start = Math.min(...inputs.map((input) => Number(input.entryId)));
  const conversation = await harness.conversation(
    Number(position.conversationId) as ConversationId,
    context,
  );
  if (conversation === undefined)
    throw new InputAuthorityError('Coordinator replay conversation is missing');
  const entries: EntryRecord[] = [];
  let cursor: Cursor | undefined;
  do {
    const page = await conversation.entries({ order: 'ascending' }, pageSize, cursor, context);
    entries.push(...page.items);
    cursor = page.next;
  } while (cursor !== undefined);
  if (watermark !== null && Number(entries.at(-1)?.id ?? 0) < watermark.entryId) return;
  const runs = new Map(
    (await channel.runs(threadId))
      .filter((run) => run.conversationId === conversationKey)
      .map((run) => [run.taskId, run.stepId]),
  );
  const tasks = new Map<string, Awaited<ReturnType<Tx['task']>>>();
  const taskFor = async (id: TaskId) => {
    if (tasks.has(String(id))) return tasks.get(String(id));
    const record = await harness.commit((tx) => tx.task(id), context);
    tasks.set(String(id), record);
    return record;
  };
  const verified = new Map<string, EntryRecord[]>();
  const assistants = new Map<string, { entry: EntryRecord; producer: string }>();
  let handled = watermark?.entryId ?? start - 1;
  let blocked: string | null = null;
  for (const entry of entries) {
    if (entry.conversationId !== conversation.id || Number(entry.id) < start) continue;
    let producer: string | undefined;
    if (UserEntry.is(entry)) {
      const owners = new Set(
        inputs.filter((input) => input.entryId === String(entry.id)).map((input) => input.stepId),
      );
      if (owners.size === 1) producer = [...owners][0];
    } else if (AssistantEntry.is(entry)) {
      if (entry.byTaskId !== undefined) {
        const task = await taskFor(entry.byTaskId);
        if (
          task?.kind === GenerationTask.definition.name &&
          task.conversationId === conversation.id
        )
          producer = runs.get(String(task.id));
      }
      if (producer !== undefined) {
        for (const message of entry.model ?? []) {
          if (message.role !== 'assistant') continue;
          for (const block of message.content)
            if (block.type === 'toolCall') assistants.set(block.id, { entry, producer });
        }
      }
    } else if (ToolResultEntry.is(entry)) {
      const message = entry.model?.[0];
      const callId = message?.role === 'toolResult' ? message.toolCallId : undefined;
      const call = callId === undefined ? undefined : assistants.get(callId);
      if (entry.byTaskId !== undefined && call !== undefined) {
        const task = await taskFor(entry.byTaskId);
        if (task?.conversationId === conversation.id) {
          if (task.kind === GenerationTask.definition.name && task.id === call.entry.byTaskId)
            producer = runs.get(String(task.id));
          else if (
            task.kind === ToolTask.definition.name &&
            task.owner === call.entry.byTaskId &&
            task.input !== null &&
            typeof task.input === 'object' &&
            !Array.isArray(task.input) &&
            task.input.kind === 'model' &&
            String(task.input.assistant) === String(call.entry.id) &&
            task.input.callId === callId
          )
            producer = call.producer;
        }
      }
    } else if (
      SystemEntry.is(entry) ||
      CompactionEntry.is(entry) ||
      (ResetEntry.is(entry) && entry.model === undefined)
    ) {
      handled = Math.max(handled, Number(entry.id));
      continue;
    }
    if (producer === undefined) {
      blocked = String(entry.id);
      break;
    }
    const group = verified.get(producer) ?? [];
    group.push(entry);
    verified.set(producer, group);
    handled = Math.max(handled, Number(entry.id));
  }
  for (const [producer, group] of verified) {
    for (const { row, entryId } of entryRowSources(producer, group, storeId)) {
      await channel.assertConversation(threadId, conversationKey);
      await api.transcriptRow(producer, row, entryId);
    }
  }
  if (handled >= start) await channel.checkpoint(threadId, conversationKey, String(handled));
  if (blocked !== null)
    throw new InputAuthorityError(`Coordinator replay has unknown ownership at entry ${blocked}`);
}
