import { cn } from 'cn';
import { SquareArrowOutUpRight } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { usePrs } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import type { OriginChiefQuestion } from '../chief/question-origin.js';
import { QuickQuestion } from '../chief/quick-question.js';
import { SidePanel, SidePanelHead, SidePanelTitle } from '../components/side-panel.js';
import type { StoneTone } from '../components/stone/tone.js';
import { ToneGlyph } from '../components/stone/tone-glyph.js';
import { PrLink } from '../components/thread/pr-link.js';
import { ThreadReply } from '../components/thread/thread-reply.js';
import { Button } from '../components/ui/button.js';
import type { TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { answeredThreads, type NeedsYou, needsYouKeyOf } from './needs-you-store.js';
import { relativeTime } from './rel-time.js';
import { threadCopy, threadTone } from './thread-copy.js';
import { useThreadReply } from './thread-reply-send.js';

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
  testId,
  tone,
  title,
  ask,
  trailing,
  open,
  onToggle,
  children,
}: {
  testId: string;
  tone: StoneTone;
  title: string;
  ask: string;
  trailing: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div
      data-testid={testId}
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
          <ToneGlyph tone={tone} className="mt-0.5 size-4 flex-none" />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="line-clamp-2 text-ui text-foreground">{title}</span>
            <span
              data-testid="needs-you-inbox-ask"
              className={cn('text-meta text-content-tertiary', !open && 'line-clamp-2')}
            >
              {ask}
            </span>
          </span>
        </Button>
        <span className="flex h-10 flex-none items-center pr-1.5">{trailing}</span>
      </div>
      {open && (
        <div
          data-testid="needs-you-inbox-answer"
          className="flex flex-col gap-2 pr-2.5 pb-2.5 pl-9.5"
        >
          {children}
        </div>
      )}
    </div>
  );
}

function ThreadEntry({
  todo,
  now,
  open,
  onToggle,
  onOpenThread,
}: {
  todo: TodoRecord;
  now: number;
  open: boolean;
  onToggle: () => void;
  onOpenThread: () => void;
}) {
  const { t } = useI18n();
  const { delivery, send } = useThreadReply(todo);
  const { live, teamId } = useLiveData();
  const pr = usePrs(teamId, undefined, live).data?.find((row) => row.threadId === todo.id);
  const [picking, setPicking] = useState<string | null>(null);
  const [pickFailed, setPickFailed] = useState(false);
  const updating = todo.waitingOn?.on === 'machine-update';
  const options = updating ? [] : (todo.ask?.options ?? []);
  const suggested = updating ? null : (todo.ask?.defaultAnswer ?? null);
  const answer = async (text: string) => {
    await send(text);
    answeredThreads.mark(todo);
  };
  const pick = (label: string) => {
    setPicking(label);
    setPickFailed(false);
    answer(label).catch(() => {
      setPicking(null);
      setPickFailed(true);
    });
  };
  return (
    <InboxRow
      testId="needs-you-inbox-row"
      tone={threadTone(todo)}
      title={todo.title}
      ask={updating ? t(threadCopy(todo).reason) : (todo.ask?.text ?? t(threadCopy(todo).reason))}
      open={open}
      onToggle={onToggle}
      trailing={
        <>
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
        </>
      }
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
      {pr !== undefined && (
        <PrLink number={pr.number} url={pr.url} className="self-start text-meta" />
      )}
      {pickFailed && (
        <p
          role="status"
          data-testid="needs-you-inbox-error"
          className="m-0 text-meta text-destructive"
        >
          {t('没发出去，再试一次。')}
        </p>
      )}
      {suggested !== null && !options.some((option) => option.label === suggested) && (
        <p className="m-0 text-meta text-content-tertiary">
          {t('Coordinator 建议：{answer}', { answer: suggested })}
        </p>
      )}
      {delivery !== null && !updating ? (
        <ThreadReply seq={todo.seqNum} delivery={delivery} onSend={answer} autoFocus />
      ) : (
        <Button variant="outline" size="sm" className="self-start" onClick={onOpenThread}>
          {t('查看 thread')}
        </Button>
      )}
    </InboxRow>
  );
}

function QuestionEntry({
  request,
  open,
  onToggle,
}: {
  request: OriginChiefQuestion;
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const first = request.item.questions[0];
  return (
    <InboxRow
      testId="needs-you-inbox-question"
      tone="waiting"
      title={first?.header ?? t('Coordinator')}
      ask={first?.question ?? ''}
      open={open}
      onToggle={onToggle}
      trailing={<span className="px-1 text-meta text-content-tertiary">{t('Coordinator')}</span>}
    >
      <QuickQuestion request={request} hideText />
    </InboxRow>
  );
}

export function NeedsYouPanel({
  needsYou,
  now,
  onOpenThread,
  onClose,
}: {
  needsYou: NeedsYou;
  now: number;
  onOpenThread: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [openId, setOpenId] = useState<string | null>(null);
  const toggle = (id: string) => setOpenId(openId === id ? null : id);
  return (
    <SidePanel label={t('待你决定')} onDismiss={onClose}>
      <SidePanelHead closeLabel={t('关闭')} onClose={onClose}>
        <SidePanelTitle>
          {t('待你决定')}
          <span className="font-normal text-content-tertiary tabular-nums">{needsYou.count}</span>
        </SidePanelTitle>
      </SidePanelHead>
      <div
        data-testid="needs-you-inbox"
        className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pt-2 pb-4"
      >
        {needsYou.count === 0 && (
          <p className="m-0 mt-[10vh] text-center text-meta text-content-tertiary">
            {t('都处理完了')}
          </p>
        )}
        {needsYou.questions.map((request) => (
          <QuestionEntry
            key={request.item.requestId}
            request={request}
            open={openId === request.item.requestId}
            onToggle={() => toggle(request.item.requestId)}
          />
        ))}
        {needsYou.threads.map((todo) => (
          <ThreadEntry
            key={needsYouKeyOf(todo)}
            todo={todo}
            now={now}
            open={openId === needsYouKeyOf(todo)}
            onToggle={() => toggle(needsYouKeyOf(todo))}
            onOpenThread={() => onOpenThread(todo.id)}
          />
        ))}
      </div>
    </SidePanel>
  );
}
