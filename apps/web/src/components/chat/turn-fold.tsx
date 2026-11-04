import { cn } from 'cn';
import { memo, type ReactNode, useCallback, useState } from 'react';
import { useI18n } from '../../i18n/provider.js';
import type { TFunc } from '../../i18n/translate.js';
import { ChevronRight } from '../../icons/index.js';
import { isTurnOpen, type Turn } from '../../lib/turn-fold.js';
import { Button } from '../ui/button.js';
import { MessageScrollerItem } from '../ui/message-scroller.js';

const SCROLLER_ITEM_STYLE = { contentVisibility: 'visible' } as const;

export function formatTurnDuration(seconds: number, t: TFunc): string {
  if (seconds < 60) return t('{n} 秒', { n: seconds });
  if (seconds < 3600) return t('{n} 分钟', { n: Math.floor(seconds / 60) });
  return t('{n} 小时', { n: Math.floor(seconds / 3600) });
}

export function useTurnFold() {
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(() => new Set());
  const isOpen = (turn: Pick<Turn<unknown>, 'id'>, defaultOpenId: string | null) =>
    isTurnOpen(turn.id, defaultOpenId, flipped);
  const toggle = useCallback(
    (id: string) =>
      setFlipped((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );
  return { isOpen, toggle };
}

const HEADER_CLS =
  "mt-2 -mx-2 h-auto w-[calc(100%+1rem)] cursor-pointer justify-start gap-1.5 rounded-(--radius-control) border-none bg-transparent px-2 py-1 text-left text-meta font-normal whitespace-nowrap hover:bg-(--menu-hover) dark:hover:bg-(--menu-hover) aria-expanded:bg-transparent active:not-aria-[haspopup]:translate-y-0 [&_svg:not([class*='size-'])]:size-auto";

export const TurnHeader = memo(function TurnHeader({
  id,
  purpose,
  status,
  seconds,
  open,
  onToggle,
}: Pick<Turn<unknown>, 'id' | 'purpose' | 'status' | 'seconds'> & {
  open: boolean;
  onToggle: (id: string) => void;
}) {
  const { t } = useI18n();
  const failed = status === 'failed';
  const duration =
    seconds === null
      ? null
      : failed
        ? t('{d}后失败', { d: formatTurnDuration(seconds, t) })
        : formatTurnDuration(seconds, t);
  const content = (
    <>
      <ChevronRight
        aria-hidden="true"
        strokeWidth={1.75}
        className={cn(
          'size-3.5 flex-none text-(--text-tertiary) transition-transform duration-(--dur-fast)',
          open && 'rotate-90',
        )}
      />
      <span
        className={cn(
          'min-w-0 truncate font-medium',
          failed ? 'text-destructive' : 'text-(--text-secondary)',
        )}
      >
        {purpose}
      </span>
      {duration !== null && (
        <span className="-ml-1.5 flex-none whitespace-pre text-(--text-tertiary)">{` · ${duration}`}</span>
      )}
    </>
  );
  return (
    <MessageScrollerItem style={SCROLLER_ITEM_STYLE}>
      <Button
        variant="ghost"
        data-testid="turn-header"
        data-state={status}
        aria-expanded={open}
        onClick={() => onToggle(id)}
        className={HEADER_CLS}
      >
        {content}
      </Button>
    </MessageScrollerItem>
  );
});

export function TurnFold({
  turn,
  open,
  onToggle,
  children,
}: {
  turn: Pick<Turn<unknown>, 'id' | 'purpose' | 'status' | 'seconds'>;
  open: boolean;
  onToggle: (id: string) => void;
  children: ReactNode;
}) {
  return (
    <>
      <TurnHeader
        id={turn.id}
        purpose={turn.purpose}
        status={turn.status}
        seconds={turn.seconds}
        open={open}
        onToggle={onToggle}
      />
      {open && children}
    </>
  );
}
