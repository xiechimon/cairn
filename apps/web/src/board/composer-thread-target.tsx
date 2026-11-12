import { type RefObject, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useApiMutations } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { useSendKey } from '../api/use-send-key.js';
import { PROJECT_CHIP_CLS, TOOL_BTN_CLS } from '../chief/composer-surface.js';
import { questionDockState } from '../chief/question-dock-state.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { THREAD_REPLY_HINT, type ThreadReplyDelivery } from '../components/thread/thread-reply.js';
import { Button } from '../components/ui/button.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu.js';
import { blockDemoWrite, DEMO_MODE } from '../demo/demo-gate.js';
import type { TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { ChevronDown, GitBranch, MessageSquare, X } from '../icons/index.js';
import { replyDeliveryOf } from './reply-delivery.js';
import { threadCopy } from './thread-copy.js';

export interface ThreadTarget {
  todo: TodoRecord;
  delivery: ThreadReplyDelivery;
}

export function threadTargetsOf(todos: readonly TodoRecord[]): ThreadTarget[] {
  return todos
    .flatMap((todo) => {
      const delivery =
        todo.latestBuildId != null && todo.archivedAt == null ? replyDeliveryOf(todo.phase) : null;
      return delivery === null ? [] : [{ todo, delivery }];
    })
    .sort((a, b) => b.todo.phaseAt - a.todo.phaseAt);
}

export interface PickedThread {
  todoId: string;
  seq: number;
  title: string;
}

export function useComposerThreadTarget(todos: readonly TodoRecord[]) {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const mutations = useApiMutations(teamId);
  const sendKey = useSendKey();
  const targets = useMemo(() => threadTargetsOf(todos), [todos]);
  const [picked, setPicked] = useState<PickedThread | null>(null);
  const pickedRef = useRef<PickedThread | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const target =
    picked === null ? null : (targets.find((c) => c.todo.id === picked.todoId) ?? null);
  const unreachable =
    picked !== null && target === null
      ? t('#{seq} 现在收不了消息。改回 Coordinator，或换一个 thread。', { seq: picked.seq })
      : null;
  const pick = (todoId: string | null) => {
    const next = targets.find((c) => c.todo.id === todoId)?.todo;
    const value = next == null ? null : { todoId: next.id, seq: next.seqNum, title: next.title };
    pickedRef.current = value;
    setPicked(value);
    setFailed(null);
  };
  const send = async (text: string) => {
    if (target === null) throw new Error('thread target unreachable');
    if (!live) {
      if (DEMO_MODE) blockDemoWrite();
      return;
    }
    const todoId = target.todo.id;
    const seq = target.todo.seqNum;
    setFailed(null);
    try {
      await mutations.messageThread.mutateAsync({
        todoId,
        content: text,
        clientMessageId: sendKey.attempt([todoId, text].join('\n'), 'thread').key,
      });
      sendKey.settle();
    } catch (error) {
      if (pickedRef.current?.todoId === todoId) setFailed(t('没发给 #{seq}，再试一次。', { seq }));
      throw error;
    }
  };
  return {
    targets,
    picked,
    pick,
    send,
    error: unreachable ?? failed,
    placeholder:
      target === null
        ? unreachable
        : t(THREAD_REPLY_HINT[target.delivery], { seq: target.todo.seqNum }),
  };
}

const COORDINATOR_VALUE = '';
const ITEM_CLS = 'h-auto min-h-8 items-start py-1.5';

interface ThreadTargetProps {
  targets: readonly ThreadTarget[];
  picked: PickedThread | null;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  onPick: (todoId: string | null) => void;
}

function ThreadTargetRadios({
  targets,
  picked,
  onPick,
}: Pick<ThreadTargetProps, 'targets' | 'picked' | 'onPick'>) {
  const { t } = useI18n();
  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel>{t('发给谁')}</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={picked?.todoId ?? COORDINATOR_VALUE}
        onValueChange={(next) => onPick(next === COORDINATOR_VALUE ? null : String(next))}
      >
        <DropdownMenuRadioItem value={COORDINATOR_VALUE} closeOnClick className={ITEM_CLS}>
          <OptionText title={t('Coordinator')} hint={t('默认，由它安排')} />
        </DropdownMenuRadioItem>
        {targets.map(({ todo }) => (
          <DropdownMenuRadioItem key={todo.id} value={todo.id} closeOnClick className={ITEM_CLS}>
            <OptionText title={`#${todo.seqNum} ${todo.title}`} hint={t(threadCopy(todo).reason)} />
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuGroup>
  );
}

export function ComposerThreadTargetMenu({
  targets,
  picked,
  onPick,
}: Omit<ThreadTargetProps, 'composerRef'>) {
  useSyncExternalStore(questionDockState.subscribe, questionDockState.snapshot, () => 0);
  const { t } = useI18n();
  if (picked === null && targets.length === 0) return null;
  if (questionDockState.uploading())
    return (
      <DropdownMenuItem disabled title={t('附件上传中')}>
        <MessageSquare width={20} height={20} />
        {t('对某个 thread 说')}
      </DropdownMenuItem>
    );
  return <ThreadTargetRadios targets={targets} picked={picked} onPick={onPick} />;
}

export function ComposerThreadTarget({ targets, picked, composerRef, onPick }: ThreadTargetProps) {
  const { t } = useI18n();
  useSyncExternalStore(questionDockState.subscribe, questionDockState.snapshot, () => 0);
  const uploading = questionDockState.uploading();
  if (picked === null) return null;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              data-testid="composer-thread-target"
              data-set=""
              aria-label={t('正在对 #{seq} 说', { seq: picked.seq })}
              disabled={uploading}
              title={uploading ? t('附件上传中') : undefined}
              className={PROJECT_CHIP_CLS}
            />
          }
        >
          <GitBranch width={16} height={16} />
          <span className="truncate">{`#${picked.seq} ${picked.title}`}</span>
          <ChevronDown width={12} height={12} />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          sideOffset={6}
          aria-label={t('发给谁')}
          finalFocus={composerRef}
          className="w-auto max-w-80 min-w-60"
        >
          <ThreadTargetRadios targets={targets} picked={picked} onPick={onPick} />
        </DropdownMenuContent>
      </DropdownMenu>
      <IconTooltip
        label={t('改回对 Coordinator 说')}
        trigger={
          <Button
            variant="ghost"
            size="icon"
            className={TOOL_BTN_CLS}
            onClick={() => {
              onPick(null);
              composerRef.current?.focus();
            }}
          />
        }
      >
        <X width={16} height={16} />
      </IconTooltip>
    </>
  );
}

function OptionText({ title, hint }: { title: string; hint: string }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate font-medium text-foreground">{title}</span>
      <span className="truncate text-caption text-content-tertiary">{hint}</span>
    </span>
  );
}
