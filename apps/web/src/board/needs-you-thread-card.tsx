import { useState } from 'react';
import { useApiMutations, usePrs } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { useSendKey } from '../api/use-send-key.js';
import { ThreadCard, type ThreadCardProps } from '../components/thread/thread-card.js';
import { ThreadReply, type ThreadReplyDelivery } from '../components/thread/thread-reply.js';
import { blockDemoWrite, DEMO_MODE } from '../demo/demo-gate.js';
import type { Phase, TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';

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

type NeedsYouThreadCardProps = Omit<ThreadCardProps, 'footer'> & { todo: TodoRecord };

export function NeedsYouThreadCard({ todo, ...card }: NeedsYouThreadCardProps) {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const mutations = useApiMutations(teamId);
  const sendKey = useSendKey();
  const pr = usePrs(teamId, undefined, live).data?.find((row) => row.threadId === todo.id);
  const prLink = pr !== undefined ? { prLink: { number: pr.number, url: pr.url } } : {};
  const [open, setOpen] = useState(false);
  const delivery = todo.latestBuildId != null ? replyDeliveryOf(todo.phase) : null;
  if (delivery === null) return <ThreadCard {...card} {...prLink} />;
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
  return (
    <ThreadCard
      {...card}
      {...prLink}
      primaryLabel={open ? t('收起') : t('回复')}
      onPrimary={() => setOpen(!open)}
      footer={
        open ? <ThreadReply seq={todo.seqNum} delivery={delivery} onSend={send} autoFocus /> : null
      }
    />
  );
}
