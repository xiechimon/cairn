import { cn } from 'cn';
import { ListChecks, MessageCircle, PackageCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { useI18n } from '../i18n/provider.js';
import { THREAD_PARAM, VIEW_PARAM } from './thread-copy.js';
import { PANE_PARAM, type WorkPane } from './work-panel.js';

export const NARROW_FLOAT_CLS = 'pointer-events-auto bg-popover shadow-(--e2)';

export const NARROW_ICON_CLS = 'size-5.5';

export function NeedsYouCount({ count, className }: { count: number; className?: string }) {
  return (
    <span
      data-testid="tasks-badge"
      className={cn(
        'absolute grid h-4.5 min-w-4.5 place-items-center rounded-full bg-(--count-badge) px-1 text-caption leading-none font-semibold tabular-nums text-(--count-badge-ink) ring-2 ring-popover',
        className,
      )}
    >
      {count}
    </span>
  );
}

function TabLink({
  search,
  current,
  children,
}: {
  search: string;
  current: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      to={{ search }}
      replace
      aria-current={current ? 'page' : undefined}
      className={cn(
        'flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-full text-caption text-content-secondary no-underline outline-none focus-visible:ring-2 focus-visible:ring-(--focus-ring)',
        current && 'bg-(--hover-1) font-semibold text-foreground',
      )}
    >
      {children}
    </Link>
  );
}

export function PhoneTabs({
  pane,
  badge,
  computers,
}: {
  pane: WorkPane | null;
  badge: number;
  computers: ReactNode;
}) {
  const { t } = useI18n();
  const { search } = useLocation();
  const withPane = (next: WorkPane | null) => {
    const params = new URLSearchParams(search);
    params.delete(THREAD_PARAM);
    params.delete(VIEW_PARAM);
    if (next === null) params.delete(PANE_PARAM);
    else params.set(PANE_PARAM, next);
    const query = params.toString();
    return query === '' ? '' : `?${query}`;
  };
  return (
    <div
      data-slot="phone-bar"
      className="pointer-events-none fixed inset-x-0 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-(--z-narrow-chrome) flex items-center justify-center gap-3 px-3"
    >
      <nav
        data-slot="phone-tabs"
        aria-label={t('对话、任务和成果')}
        className={cn(
          NARROW_FLOAT_CLS,
          'flex h-16.5 max-w-82.5 min-w-0 flex-1 rounded-full p-1.25',
        )}
      >
        <TabLink search={withPane(null)} current={pane === null}>
          <MessageCircle aria-hidden className={NARROW_ICON_CLS} strokeWidth={1.75} />
          {t('对话')}
        </TabLink>
        <TabLink search={withPane('tasks')} current={pane === 'tasks'}>
          <span className="relative">
            <ListChecks aria-hidden className={NARROW_ICON_CLS} strokeWidth={1.75} />
            {badge > 0 && <NeedsYouCount count={badge} className="-top-2 left-3" />}
          </span>
          {t('任务')}
        </TabLink>
        <TabLink search={withPane('made')} current={pane === 'made'}>
          <PackageCheck aria-hidden className={NARROW_ICON_CLS} strokeWidth={1.75} />
          {t('成果')}
        </TabLink>
      </nav>
      <div className="pointer-events-auto flex-none">{computers}</div>
    </div>
  );
}
