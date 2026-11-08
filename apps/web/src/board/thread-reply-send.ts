import { useApiMutations } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { useSendKey } from '../api/use-send-key.js';
import type { ThreadReplyDelivery } from '../components/thread/thread-reply.js';
import { blockDemoWrite, DEMO_MODE } from '../demo/demo-gate.js';
import type { Phase, TodoRecord } from '../fixtures/records.js';

export function replyDeliveryOf(phase: Phase): ThreadReplyDelivery | null {
  switch (phase) {
    case 'needs_input':
      return 'answer';
    case 'confirm':
    case 'review':
      return 'revision';
    case 'failed':
      return 'restart';
    case 'building':
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
  const delivery = todo.latestBuildId != null ? replyDeliveryOf(todo.phase) : null;
  const send = async (content: string) => {
    if (!live) {
      if (DEMO_MODE) blockDemoWrite();
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
