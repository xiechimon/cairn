import { useState } from 'react';
import { useApiMutations, useTodos } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { useSendKey } from '../api/use-send-key.js';
import { replyDeliveryOf } from '../board/reply-delivery.js';
import { ThreadReply } from '../components/thread/thread-reply.js';
import { Button } from '../components/ui/button.js';
import { useI18n } from '../i18n/provider.js';
import { useFocusQuestionOfTodo } from './chief-question.js';

function LiveThreadReportReply({ todoId }: { todoId: string }) {
  const { t } = useI18n();
  const { teamId } = useLiveData();
  const todos = useTodos(teamId, true);
  const mutations = useApiMutations(teamId);
  const sendKey = useSendKey();
  const [open, setOpen] = useState(false);
  const focusQuestion = useFocusQuestionOfTodo(todoId);
  const todo = todos.data?.find((candidate) => candidate.id === todoId);
  if (todo === undefined || todo.phase !== 'needs_input') return null;
  if (focusQuestion !== null) {
    return (
      <div className="mb-3 flex flex-col items-start gap-2" data-testid="thread-report-reply">
        <Button size="sm" variant="ghost" onClick={focusQuestion}>
          {t('回复')}
        </Button>
      </div>
    );
  }
  const send = async (content: string) => {
    await mutations.messageThread.mutateAsync({
      todoId,
      content,
      clientMessageId: sendKey.attempt([todoId, content].join('\n'), 'thread').key,
    });
    sendKey.settle();
  };
  return (
    <div className="mb-3 flex flex-col items-start gap-2" data-testid="thread-report-reply">
      <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>
        {open ? t('收起') : t('回复')}
      </Button>
      {open && (
        <ThreadReply
          delivery={replyDeliveryOf(todo.phase) ?? 'steer'}
          onSend={send}
          autoFocus
          className="w-full"
        />
      )}
    </div>
  );
}

export function ThreadReportReply({ todoId }: { todoId: string }) {
  const { live } = useLiveData();
  return live ? <LiveThreadReportReply todoId={todoId} /> : null;
}
