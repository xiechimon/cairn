import { cn } from 'cn';
import { SquareArrowOutUpRight } from 'lucide-react';
import { useState } from 'react';
import { SidePanel, SidePanelHead, SidePanelTitle } from '../components/side-panel.js';
import { ToneGlyph } from '../components/stone/tone-glyph.js';
import { ThreadReply } from '../components/thread/thread-reply.js';
import { Button } from '../components/ui/button.js';
import type { TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { relativeTime } from './rel-time.js';
import { threadCopy, threadTone } from './thread-copy.js';
import { useThreadReply } from './thread-reply-send.js';

export interface NeedsYouInbox {
  entries: TodoRecord[];
  markAnswered: (todo: TodoRecord) => void;
}

function answerKeyOf(todo: TodoRecord): string {
  return `${todo.id}:${todo.ask?.requestId ?? todo.phaseAt}`;
}

export function useNeedsYouInbox(threads: readonly TodoRecord[]): NeedsYouInbox {
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set());
  return {
    entries: threads.filter((todo) => !answered.has(answerKeyOf(todo))),
    markAnswered: (todo) => setAnswered((prev) => new Set([...prev, answerKeyOf(todo)])),
  };
}

export function NeedsYouChip({
  count,
  open,
  onToggle,
}: {
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  if (count === 0) return null;
  return (
    <Button
      data-testid="needs-you-chip"
      variant="ghost"
      size="sm"
      aria-pressed={open}
      aria-label={t('待你决定 {n} 件', { n: count })}
      onClick={onToggle}
      className="flex-none gap-1.5 text-meta font-normal text-content-secondary hover:text-foreground aria-pressed:bg-(--hover-1) aria-pressed:text-foreground"
    >
      <ToneGlyph tone="waiting" className="size-3.5" />
      {t('待你决定')}
      <span data-testid="needs-you-count" className="tabular-nums">
        {count}
      </span>
    </Button>
  );
}

function InboxRow({
  todo,
  now,
  open,
  onToggle,
  onOpenThread,
  onAnswered,
}: {
  todo: TodoRecord;
  now: number;
  open: boolean;
  onToggle: () => void;
  onOpenThread: () => void;
  onAnswered: () => void;
}) {
  const { t } = useI18n();
  const { delivery, send } = useThreadReply(todo);
  const [picking, setPicking] = useState<string | null>(null);
  const ask = todo.ask?.text ?? t(threadCopy(todo).reason);
  const options = todo.ask?.options ?? [];
  const suggested = todo.ask?.defaultAnswer ?? null;
  const answer = async (text: string) => {
    await send(text);
    onAnswered();
  };
  const pick = (label: string) => {
    setPicking(label);
    answer(label).catch(() => setPicking(null));
  };
  return (
    <div
      data-testid="needs-you-inbox-row"
      data-open={open ? '' : undefined}
      className={cn(
        'group/row rounded-(--radius-control) hover:bg-(--menu-hover)',
        open && 'bg-(--menu-hover)',
      )}
    >
      <div className="flex items-start">
        <Button
          variant="ghost"
          data-testid="needs-you-inbox-toggle"
          aria-expanded={open}
          onClick={onToggle}
          className="h-auto min-w-0 flex-1 items-start justify-start gap-3 rounded-(--radius-control) py-2.5 pr-1 pl-2.5 text-left font-normal whitespace-normal hover:bg-transparent aria-expanded:bg-transparent dark:hover:bg-transparent"
        >
          <ToneGlyph tone={threadTone(todo)} className="mt-0.5 size-4 flex-none" />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="line-clamp-2 text-ui text-foreground">{todo.title}</span>
            <span
              data-testid="needs-you-inbox-ask"
              className={cn('text-meta text-content-tertiary', !open && 'line-clamp-2')}
            >
              {ask}
            </span>
          </span>
        </Button>
        <span className="flex h-10 flex-none items-center pr-1.5">
          <span className="px-1 text-meta text-content-tertiary tabular-nums group-focus-within/row:hidden group-hover/row:hidden pointer-coarse:hidden">
            {relativeTime(todo.phaseAt, now, t)}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('查看 thread')}
            className="hidden text-content-tertiary group-focus-within/row:flex group-hover/row:flex pointer-coarse:flex"
            onClick={onOpenThread}
          >
            <SquareArrowOutUpRight aria-hidden="true" />
          </Button>
        </span>
      </div>
      {open && (
        <div
          data-testid="needs-you-inbox-answer"
          className="flex flex-col gap-2 pr-2.5 pb-2.5 pl-9.5"
        >
          {options.length > 0 && delivery !== null && (
            <div className="flex flex-wrap gap-1.5">
              {options.map((option) => (
                <Button
                  key={option.label}
                  size="sm"
                  variant={option.label === suggested ? 'default' : 'outline'}
                  title={option.description}
                  disabled={picking !== null}
                  onClick={() => pick(option.label)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          )}
          {suggested !== null && !options.some((option) => option.label === suggested) && (
            <p className="m-0 text-meta text-content-tertiary">
              {t('Coordinator 建议：{answer}', { answer: suggested })}
            </p>
          )}
          {delivery !== null ? (
            <ThreadReply seq={todo.seqNum} delivery={delivery} onSend={answer} autoFocus />
          ) : (
            <Button variant="outline" size="sm" className="self-start" onClick={onOpenThread}>
              {t('查看 thread')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export function NeedsYouPanel({
  inbox,
  now,
  onOpenThread,
  onClose,
}: {
  inbox: NeedsYouInbox;
  now: number;
  onOpenThread: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <SidePanel label={t('待你决定')} onDismiss={onClose}>
      <SidePanelHead closeLabel={t('关闭')} onClose={onClose}>
        <SidePanelTitle>
          {t('待你决定')}
          <span className="font-normal text-content-tertiary tabular-nums">
            {inbox.entries.length}
          </span>
        </SidePanelTitle>
      </SidePanelHead>
      <div
        data-testid="needs-you-inbox"
        className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pt-2 pb-4"
      >
        {inbox.entries.length === 0 ? (
          <p className="m-0 mt-[10vh] text-center text-meta text-content-tertiary">
            {t('都处理完了')}
          </p>
        ) : (
          inbox.entries.map((todo) => (
            <InboxRow
              key={todo.id}
              todo={todo}
              now={now}
              open={openId === todo.id}
              onToggle={() => setOpenId(openId === todo.id ? null : todo.id)}
              onOpenThread={() => onOpenThread(todo.id)}
              onAnswered={() => inbox.markAnswered(todo)}
            />
          ))
        )}
      </div>
    </SidePanel>
  );
}
