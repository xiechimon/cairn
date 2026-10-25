import { Atom } from 'loading-dev';
import { type ReactNode, useEffect, useState } from 'react';
import { useI18n } from '../../i18n/provider.js';
import type { TVars } from '../../i18n/translate.js';
import { ChevronDown, ChevronRight } from '../../icons/index.js';
import { Button } from '../ui/button.js';

export function useLiveSeconds(startedAt: number | null | undefined): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt == null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  if (startedAt == null) return null;
  return Math.max(1, Math.round((now - startedAt) / 1000));
}

const SKIN = {
  detail: {
    head: 'ml-[15px] flex h-5 max-w-full items-center gap-1.5 overflow-hidden whitespace-nowrap text-xs leading-4 text-(--text-tertiary)',
    headBtn:
      "h-6 -my-0.5 cursor-pointer rounded-none justify-start border-none bg-transparent py-0.5 text-left text-[length:inherit] leading-[inherit] font-normal hover:bg-transparent hover:text-(--text-tertiary) dark:hover:bg-transparent dark:hover:text-(--text-tertiary) aria-expanded:bg-transparent aria-expanded:text-(--text-tertiary) active:not-aria-[haspopup]:translate-y-0 [&_svg:not([class*='size-'])]:size-auto",
    spinner:
      'flex-none text-(--card-button) animate-[spinner-breathe_3600ms_var(--ease-standard)_infinite] motion-reduce:animate-none',
    secs: 'tabular-nums',
    rowTestid: 'live-row',
    label: 'chat-streaming-label truncate text-(--text-tertiary)',
  },
  chief: {
    rowTestid: undefined,
    head: 'flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap text-xs leading-4 text-(--text-tertiary)',
    headBtn:
      "-my-[1.5px] h-auto cursor-pointer rounded-none justify-start border-none bg-transparent py-[1.5px] text-left text-sm leading-normal font-normal hover:bg-transparent hover:text-(--text-tertiary) dark:hover:bg-transparent dark:hover:text-(--text-tertiary) aria-expanded:bg-transparent aria-expanded:text-(--text-tertiary) active:not-aria-[haspopup]:translate-y-0 [&_svg:not([class*='size-'])]:size-auto",
    spinner:
      'flex-none animate-[spinner-breathe_3600ms_var(--ease-standard)_infinite] text-(--card-button) motion-reduce:animate-none',
    secs: 'tabular-nums',
    label: 'truncate text-(--text-tertiary)',
  },
} as const;

export function LiveSignal({ at, className }: { at?: number | null; className: string }) {
  const { t } = useI18n();
  const secs = useLiveSeconds(at ?? null);
  if (secs == null) return null;
  return <span className={className}>{t('最近信号：{n}s 前', { n: secs })}</span>;
}

export interface LiveRowProps {
  variant: keyof typeof SKIN;
  label: string;
  labelVars?: TVars;
  startedAt?: number | null;
  seconds?: number | null;
  disclosure?: { expand: string; collapse: string } | null;
  children?: ReactNode;
}

export function LiveRow({
  variant,
  label,
  labelVars,
  startedAt,
  seconds,
  disclosure = null,
  children,
}: LiveRowProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const tick = useLiveSeconds(startedAt);
  const shown = tick ?? seconds ?? null;
  const skin = SKIN[variant];
  const body = (
    <>
      <Atom size={16} duration={1800} className={skin.spinner} />
      {shown != null && <span className={skin.secs}>{shown}s</span>}
      {disclosure != null &&
        (expanded ? (
          <ChevronDown width={10} height={10} />
        ) : (
          <ChevronRight width={10} height={10} />
        ))}
      <span className={skin.label}>{t(label, labelVars)}</span>
    </>
  );
  return (
    <>
      {disclosure == null ? (
        <span className={skin.head} data-testid={skin.rowTestid}>
          {body}
        </span>
      ) : (
        <Button
          variant="ghost"
          className={`${skin.head} ${skin.headBtn}`}
          data-testid={skin.rowTestid}
          aria-label={t(expanded ? disclosure.collapse : disclosure.expand)}
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {body}
        </Button>
      )}
      {disclosure != null && expanded && children}
    </>
  );
}
