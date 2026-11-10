import { cn } from 'cn';
import { ListChecks, MessageCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { useI18n } from '../i18n/provider.js';
import { THREAD_PARAM, VIEW_PARAM } from './thread-copy.js';
import { PANE_PARAM } from './work-panel.js';

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
        'flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-caption text-content-tertiary outline-none focus-visible:ring-2 focus-visible:ring-(--focus-ring)',
        current && 'font-semibold text-foreground',
      )}
    >
      {children}
    </Link>
  );
}

export function PhoneTabs({ tasksOpen, badge }: { tasksOpen: boolean; badge: number }) {
  const { t } = useI18n();
  const { search } = useLocation();
  const withPane = (pane: string | null) => {
    const params = new URLSearchParams(search);
    params.delete(THREAD_PARAM);
    params.delete(VIEW_PARAM);
    if (pane === null) params.delete(PANE_PARAM);
    else params.set(PANE_PARAM, pane);
    const query = params.toString();
    return query === '' ? '' : `?${query}`;
  };
  return (
    <nav
      aria-label={t('对话和任务')}
      className="flex flex-none border-t border-border bg-background pb-[env(safe-area-inset-bottom)]"
    >
      <TabLink search={withPane(null)} current={!tasksOpen}>
        <MessageCircle aria-hidden className="size-4.5" strokeWidth={1.75} />
        {t('对话')}
      </TabLink>
      <TabLink search={withPane('tasks')} current={tasksOpen}>
        <span className="relative">
          <ListChecks aria-hidden className="size-4.5" strokeWidth={1.75} />
          {badge > 0 && (
            <span
              data-testid="tasks-badge"
              className="absolute -top-1.5 left-3 min-w-4 rounded-full bg-(--card-button) px-1 text-center text-caption leading-4 font-semibold tabular-nums text-(--text-on-accent)"
            >
              {badge}
            </span>
          )}
        </span>
        {t('任务')}
      </TabLink>
    </nav>
  );
}
