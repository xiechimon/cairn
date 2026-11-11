import { cn } from 'cn';
import { AlarmClockOff, GitPullRequest } from 'lucide-react';
import type { ReactNode } from 'react';
import { useI18n } from '../../i18n/provider.js';
import type { StoneTone } from '../stone/tone.js';
import { Button } from '../ui/button.js';
import { Checkbox } from '../ui/checkbox.js';
import { PrLink } from './pr-link.js';

const TONE_LABEL: Record<StoneTone, string> = {
  waiting: '等你处理',
  failed: '失败',
  review: '等你审阅',
  working: '进行中',
  idle: '空闲',
  resolved: '已完成',
};

export interface ThreadRowProps {
  title: string;
  reason: ReactNode;
  tone: StoneTone;
  pr?: number;
  prLink?: { number: number; url: string };
  age?: string;
  snoozed?: boolean;
  selected?: boolean;
  onSelectedChange?: (next: boolean) => void;
  onOpen?: () => void;
  menu?: ReactNode;
}

export function ThreadRow({
  title,
  reason,
  tone,
  pr,
  prLink,
  age,
  snoozed = false,
  selected = false,
  onSelectedChange,
  onOpen,
  menu,
}: ThreadRowProps) {
  const { t } = useI18n();
  const quietTitle = tone === 'idle' || tone === 'resolved';
  return (
    <div
      data-slot="thread-row"
      data-tone={tone}
      data-selected={selected ? '' : undefined}
      className={cn(
        'group/row relative flex items-start gap-2.5 rounded-(--radius-control) py-1.75 pr-2.5 pl-8.5 hover:bg-(--menu-hover)',
        selected && 'bg-(--menu-hover)',
      )}
    >
      <span
        className={cn(
          'absolute top-2.25 left-2 hidden group-focus-within/row:flex group-hover/row:flex',
          selected && 'flex',
        )}
      >
        <Checkbox
          checked={selected}
          aria-label={t('选择 {title}', { title })}
          onCheckedChange={(next) => onSelectedChange?.(next)}
        />
      </span>
      <Button
        variant="ghost"
        onClick={onOpen}
        className="h-auto min-w-0 flex-1 flex-col items-stretch gap-0.5 p-0 text-left font-normal hover:bg-transparent dark:hover:bg-transparent"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              'min-w-0 truncate text-ui',
              quietTitle ? 'text-content-secondary' : 'text-foreground',
            )}
          >
            {title}
          </span>
          {pr != null && (
            <span className="inline-flex flex-none items-center gap-0.5 text-meta text-content-tertiary tabular-nums">
              <GitPullRequest className="size-4" />#{pr}
            </span>
          )}
        </span>
        <span className="truncate text-meta text-content-tertiary">{reason}</span>
        <span className="sr-only">{t(TONE_LABEL[tone])}</span>
      </Button>
      {prLink != null && (
        <PrLink number={prLink.number} url={prLink.url} className="pt-px text-meta" />
      )}
      <span
        className={cn(
          'flex-none pt-px text-meta text-content-tertiary tabular-nums',
          tone === 'working' && 'text-running-text',
          menu != null && 'group-focus-within/row:invisible group-hover/row:invisible',
        )}
      >
        {snoozed ? <AlarmClockOff className="size-4" aria-label={t('已暂停')} /> : age}
      </span>
      {menu != null && (
        <span className="absolute top-1.5 right-1.5 hidden items-center group-focus-within/row:flex group-hover/row:flex">
          {menu}
        </span>
      )}
    </div>
  );
}
