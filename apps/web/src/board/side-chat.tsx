import { X } from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';
import { SidePanel } from '../components/side-panel.js';
import { ToneGlyph } from '../components/stone/tone-glyph.js';
import { Button } from '../components/ui/button.js';
import { Composer } from '../detail/composer.js';
import { TranscriptColumn } from '../detail/transcript-column.js';
import type { TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { relativeTime } from './rel-time.js';
import { type ThreadActions, useThreadActions } from './thread-actions.js';
import { threadCopy, threadTone } from './thread-copy.js';
import { type ThreadChat, useThreadChat } from './use-thread-chat.js';

const OVERLAY_QUERY = '(max-width: 1100px)';

const OPEN_SURFACE = '.overlay, [role="dialog"], [role="menu"], [role="listbox"]';

function StatusLine({
  todo,
  machineName,
  now,
}: {
  todo: TodoRecord;
  machineName: string | null;
  now: number;
}) {
  const { t } = useI18n();
  const meta = [machineName, relativeTime(todo.phaseAt, now, t)].filter((part) => part != null);
  return (
    <p
      data-testid="side-chat-status"
      className="m-0 flex min-w-0 items-center gap-1.5 pl-5 text-meta text-content-tertiary"
    >
      <span className="flex-none font-medium text-content-secondary">
        {t(threadCopy(todo).state)}
      </span>
      <span aria-hidden="true">·</span>
      <span className="min-w-0 truncate">{meta.join(' · ')}</span>
    </p>
  );
}

function Unavailable({ chat }: { chat: ThreadChat }) {
  const { t } = useI18n();
  return (
    <div
      data-testid="side-chat-unavailable"
      data-state={chat.load}
      className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center"
    >
      <p className="m-0 text-ui text-content-tertiary">
        {chat.load === 'loading'
          ? t('加载中…')
          : chat.load === 'error'
            ? t('任务加载失败')
            : t('任务不存在或已被删除')}
      </p>
      {chat.load === 'error' && (
        <Button size="sm" onClick={chat.retry}>
          {t('重试')}
        </Button>
      )}
    </div>
  );
}

function ThreadBody({
  chat,
  todo,
  actions,
}: {
  chat: ThreadChat;
  todo: TodoRecord;
  actions: ThreadActions;
}) {
  const { t } = useI18n();
  const archived = todo.archivedAt != null;
  return (
    <>
      <TranscriptColumn
        transcript={chat.transcript}
        liveStep={null}
        agent={null}
        spec={todo.spec.trim() !== '' ? todo.spec : undefined}
        autoScroll={chat.transcript.length > 0}
      />
      {chat.sendError != null && (
        <p
          data-testid="side-chat-send-error"
          className="m-0 mx-4 mb-2 text-center text-meta text-destructive"
        >
          {chat.sendError}
        </p>
      )}
      {actions.card}
      <Composer
        placeholder={
          archived
            ? t('已归档，取消归档后才能继续')
            : todo.phase === 'closed'
              ? t('已关闭，不能再回复')
              : chat.started
                ? t('回复 #{seq}…', { seq: todo.seqNum })
                : t('开始后才能回复 #{seq}', { seq: todo.seqNum })
        }
        aiReview={false}
        streaming={chat.running}
        workingFor={chat.workingFor}
        editable={chat.send !== undefined}
        readOnly={chat.send === undefined}
        {...(chat.send !== undefined ? { onSend: chat.send } : {})}
        {...(chat.queue !== undefined ? { onQueue: chat.queue } : {})}
        {...(chat.stopAndSend !== undefined ? { onStopAndSend: chat.stopAndSend } : {})}
        {...(chat.stop !== undefined ? { onStop: chat.stop } : {})}
        {...(chat.attach !== undefined ? { onAttachment: chat.attach } : {})}
        queuedMessages={chat.queuedMessages}
        onSendQueuedNow={chat.sendQueuedNow}
        onRemoveQueued={chat.removeQueued}
      />
    </>
  );
}

export function SideChat({
  todoId,
  listed,
  now,
  onClose,
}: {
  todoId: string;
  listed: TodoRecord | undefined;
  now: number;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const chat = useThreadChat(todoId, listed);
  const todo = chat.todo;

  const panelRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const releaseCovered = (target: EventTarget | null) => {
      const panel = panelRef.current;
      if (panel === null || !(target instanceof HTMLElement)) return;
      if (!window.matchMedia(OVERLAY_QUERY).matches || panel.contains(target)) return;
      if (target.closest('[role="dialog"], [role="alertdialog"], [role="menu"]') !== null) return;
      target.blur();
    };
    releaseCovered(document.activeElement);
    const onFocusIn = (event: FocusEvent) => releaseCovered(event.target);
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector(OPEN_SURFACE) !== null) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <SidePanel ref={panelRef} label={todo?.title ?? t('任务')} onDismiss={onClose}>
      {todo != null && chat.load === 'ready' ? (
        <ReadyThread todo={todo} chat={chat} now={now} onClose={onClose} />
      ) : (
        <>
          <Head todoId={todoId} todo={null} onClose={onClose} />
          <Unavailable chat={chat} />
        </>
      )}
    </SidePanel>
  );
}

function ReadyThread({
  todo,
  chat,
  now,
  onClose,
}: {
  todo: TodoRecord;
  chat: ThreadChat;
  now: number;
  onClose: () => void;
}) {
  const actions = useThreadActions({ todo, chat, onGone: onClose });
  return (
    <>
      <Head todoId={todo.id} todo={todo} onClose={onClose} menu={actions.menu}>
        <StatusLine todo={todo} machineName={chat.machineName} now={now} />
      </Head>
      <ThreadBody chat={chat} todo={todo} actions={actions} />
    </>
  );
}

function Head({
  todoId,
  todo,
  onClose,
  menu,
  children,
}: {
  todoId: string;
  todo: TodoRecord | null;
  onClose: () => void;
  menu?: ReactNode;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <header
      data-testid="side-chat"
      data-todo-id={todoId}
      className="flex flex-none flex-col gap-0.5 border-b border-border pt-2.5 pr-2.5 pb-2.5 pl-4"
    >
      <div className="flex min-w-0 items-center gap-1">
        {todo != null && <ToneGlyph tone={threadTone(todo)} className="size-3.5 flex-none" />}
        <h2 className="m-0 ml-0.5 min-w-0 flex-1 truncate text-ui font-semibold text-foreground">
          {todo != null ? (
            <>
              <span className="font-normal text-content-tertiary tabular-nums">#{todo.seqNum}</span>{' '}
              {todo.title}
            </>
          ) : (
            t('任务')
          )}
        </h2>
        {menu}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('关闭')}
          onClick={onClose}
          className="text-content-tertiary hover:text-foreground"
        >
          <X aria-hidden="true" strokeWidth={1.75} className="size-4" />
        </Button>
      </div>
      {children}
    </header>
  );
}
