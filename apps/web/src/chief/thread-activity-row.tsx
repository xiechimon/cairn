import { type ReactNode, useState } from 'react';
import { reportStatusWord } from '../board/status-words.js';
import { ThreadLink } from '../board/thread-link.js';
import { TraceChevron } from '../components/chat/trace-parts.js';
import { Button } from '../components/ui/button.js';
import { REPLY_BUBBLE_CLS } from '../detail/chat-markdown.js';
import { useI18n } from '../i18n/provider.js';
import { FileText } from '../icons/index.js';
import {
  type ActivitySummary,
  activitySummary,
  type ThreadActivity,
  type ThreadEventItem,
} from './thread-activity.js';

const REF_MARK = '\u0001';

const BUBBLE_CLS = `${REPLY_BUBBLE_CLS} min-w-0 text-ui leading-5 text-(--foreground)`;
const ROW_CLS = 'flex min-w-0 items-center gap-1.5';
const EVENT_CLS = `${BUBBLE_CLS} flex items-start gap-1.5`;
const ICON_CLS = 'flex-none text-(--text-tertiary)';
const TOGGLE_CLS =
  "-my-0.5 size-6 min-h-0 flex-none cursor-pointer justify-center rounded-(--radius-control) border-0 bg-transparent p-0 text-meta font-normal text-(--text-tertiary) hover:bg-(--menu-hover) dark:hover:bg-(--menu-hover) aria-expanded:bg-transparent aria-expanded:hover:bg-(--menu-hover) dark:aria-expanded:hover:bg-(--menu-hover) [&_svg:not([class*='size-'])]:size-auto";
const REF_CLS = 'cursor-pointer hover:text-(--foreground) hover:underline';
const EVENT_LIST_CLS =
  'mt-1 mb-0.5 ml-5 flex min-w-0 flex-col gap-0.5 border-s border-(--border) ps-3';

function useRefSentence() {
  const { t } = useI18n();
  return (source: string, todoId: string, title: string, vars: Record<string, string | number>) => {
    const text = t(source, { ...vars, n: REF_MARK });
    const at = text.indexOf(REF_MARK);
    if (at < 0) return text;
    return (
      <>
        {text.slice(0, at)}
        <ThreadLink todoId={todoId} className={REF_CLS}>
          {title}
        </ThreadLink>
        {text.slice(at + REF_MARK.length)}
      </>
    );
  };
}

export function ThreadEventLine({
  item,
  testId,
}: {
  item: ThreadEventItem;
  testId?: string;
}): ReactNode {
  const { t } = useI18n();
  const sentence = useRefSentence();
  const phase = item.kind === 'thread-report' ? item.phase : undefined;
  return (
    <div className={EVENT_CLS} data-testid={testId ?? eventTestId(item)} data-phase={phase}>
      <FileText width={16} height={16} className={`${ICON_CLS} mt-0.5`} />
      <span className="min-w-0 break-words">
        {item.kind === 'thread-report'
          ? sentence('{n}：{status}', item.todoId, item.title, {
              status: t(reportStatusWord(item)),
            })
          : sentence(
              item.by === 'coordinator'
                ? 'Coordinator 直接对 {n} 说：{excerpt}'
                : '你直接对 {n} 说：{excerpt}',
              item.todoId,
              item.title,
              { excerpt: item.excerpt },
            )}
        {item.kind === 'thread-report' && item.line !== undefined && (
          <span className="ml-1.5">{item.line}</span>
        )}
      </span>
    </div>
  );
}

function eventTestId(item: ThreadEventItem): string {
  return item.kind === 'thread-report' ? 'thread-report-marker' : 'thread-message-marker';
}

function ExpandedEvent({ item }: { item: ThreadEventItem }) {
  const { t } = useI18n();
  const body =
    item.kind === 'thread-report'
      ? `${t(reportStatusWord(item))}${item.line !== undefined ? ` ${item.line}` : ''}`
      : t(item.by === 'coordinator' ? 'Coordinator：{excerpt}' : '你：{excerpt}', {
          excerpt: item.excerpt,
        });
  return (
    <div
      className="min-w-0 truncate text-meta leading-5 text-(--text-secondary)"
      data-testid="thread-activity-event"
      title={body}
    >
      {body}
    </div>
  );
}

function SummaryText({ summary, todoId }: { summary: ActivitySummary; todoId: string }) {
  const { t } = useI18n();
  const sentence = useRefSentence();
  const parts = [
    ...(summary.messages > 0 ? [t('{n} 次追问', { n: summary.messages })] : []),
    ...(summary.status !== null ? [t(summary.status)] : []),
  ];
  return (
    <>
      {sentence('{n}', todoId, summary.title, {})}
      {parts.map((part) => (
        <span key={part}>{` · ${part}`}</span>
      ))}
    </>
  );
}

export function ThreadActivityRow({ activity }: { activity: ThreadActivity }) {
  const [open, setOpen] = useState(false);
  const { t } = useI18n();
  const [only] = activity.events;
  if (activity.events.length === 1 && only !== undefined) return <ThreadEventLine item={only} />;
  const summary = activitySummary(activity);
  return (
    <div className={`${BUBBLE_CLS} flex flex-col`} data-testid="thread-activity">
      <div className={ROW_CLS}>
        <FileText width={16} height={16} className={ICON_CLS} />
        <span className="min-w-0 truncate" data-testid="thread-activity-summary">
          <SummaryText summary={summary} todoId={activity.todoId} />
        </span>
        <Button
          variant="ghost"
          className={TOGGLE_CLS}
          aria-expanded={open}
          aria-label={t(open ? '收起活动' : '展开活动')}
          onClick={() => setOpen(!open)}
          data-testid="thread-activity-toggle"
        >
          <TraceChevron open={open} />
        </Button>
      </div>
      {open && (
        <div className={EVENT_LIST_CLS}>
          {activity.events.map((event) => (
            <ExpandedEvent key={event.id} item={event} />
          ))}
        </div>
      )}
    </div>
  );
}
