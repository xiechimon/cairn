import { useApiMutations } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { useSendKey } from '../api/use-send-key.js';
import type { ThreadReplyDelivery } from '../components/thread/thread-reply.js';
import { blockDemoWrite, DEMO_MODE } from '../demo/demo-gate.js';
import type { Phase, TodoRecord } from '../fixtures/records.js';

export function replyDeliveryOf(phase: Phase): ThreadReplyDelivery | null {
  switch (phase) {
    case 'confirm':
    case 'review':
      return 'revision';
    case 'failed':
      return 'restart';
    case 'building':
    case 'needs_input':
    case 'done':
      return 'steer';
    default:
      return null;
  }
}

export function useThreadReply(todo: TodoRecord): {
  delivery: ThreadReplyDelivery | null;
  send: (content: string) => Promise<void>;
} {
  const { live, teamId } = useLiveData();
  const mutations = useApiMutations(teamId);
  const sendKey = useSendKey();
  const requestId = todo.phase === 'needs_input' ? (todo.ask?.requestId ?? null) : null;
  const delivery =
    todo.latestBuildId == null ? null : requestId !== null ? 'answer' : replyDeliveryOf(todo.phase);
  const send = async (content: string) => {
    if (!live) {
      if (DEMO_MODE) blockDemoWrite();
      return;
    }
    if (requestId !== null) {
      await mutations.answerThreadQuestion.mutateAsync({
        todoId: todo.id,
        requestId,
        answer: content,
      });
      return;
    }
    await mutations.messageThread.mutateAsync({
      todoId: todo.id,
      content,
      clientMessageId: sendKey.attempt([todo.id, content].join('\n'), 'thread').key,
    });
    sendKey.settle();
  };
  return { delivery, send };
}
