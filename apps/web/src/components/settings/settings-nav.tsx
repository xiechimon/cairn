import { cn } from 'cn';
import { Search } from 'lucide-react';
import type { ComponentType, ReactNode, SVGProps } from 'react';
import { Link, type To } from 'react-router';
import { useI18n } from '../../i18n/provider.js';
import { FORM_CONTROL_CLS } from '../form-layout.js';
import { Input } from '../ui/input.js';

export interface SettingsNavItem {
  id: string;
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  badge?: string;
}

export interface SettingsNavGroup {
  heading: string | null;
  items: SettingsNavItem[];
}

export function SettingsNav({
  groups,
  current,
  hrefFor,
  query,
  onQuery,
  linkState,
  top,
}: {
  groups: SettingsNavGroup[];
  current: string | null;
  hrefFor: (id: string) => To;
  query: string;
  onQuery: (next: string) => void;
  linkState?: unknown;
  top?: ReactNode;
}) {
  const { t } = useI18n();
  const needle = query.trim().toLowerCase();
  const visible = groups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) => needle === '' || item.label.toLowerCase().includes(needle),
      ),
    }))
    .filter((group) => group.items.length > 0);
  return (
    <nav aria-label={t('设置分区')} className="flex h-full min-h-0 flex-col gap-4 px-3 py-4">
      {top}
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-content-tertiary"
        />
        <Input
          aria-label={t('搜索设置')}
          className={cn(FORM_CONTROL_CLS, 'pl-8')}
          placeholder={t('搜索设置')}
          value={query}
          onChange={(event) => onQuery(event.target.value)}
        />
      </div>
      <div className="flex min-h-0 flex-auto flex-col gap-4 overflow-y-auto">
        {visible.length === 0 && (
          <p className="m-0 px-2.5 text-meta text-content-tertiary">{t('没有匹配的设置')}</p>
        )}
        {visible.map((group) => (
          <div key={group.heading ?? group.items[0]?.id} className="flex flex-col gap-px">
            {group.heading !== null && (
              <span className="px-2.5 pb-1 text-caption font-medium text-content-tertiary">
                {group.heading}
              </span>
            )}
            {group.items.map((item) => (
              <Link
                key={item.id}
                to={hrefFor(item.id)}
                state={linkState}
                replace
                data-settings-section={item.id}
                aria-current={current === item.id ? 'page' : undefined}
                className={cn(
                  'flex h-8 items-center gap-2.5 rounded-(--radius-control) px-2.5 text-ui no-underline transition-colors duration-(--dur-fast) outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  current === item.id
                    ? 'bg-(--sidebar-active) font-medium text-foreground'
                    : 'text-content-secondary hover:bg-sidebar-hover hover:text-foreground',
                )}
              >
                <item.Icon aria-hidden className="size-4 flex-none" strokeWidth={1.75} />
                <span className="min-w-0 flex-auto truncate">{item.label}</span>
                {item.badge !== undefined && (
                  <span className="text-caption text-content-secondary">{item.badge}</span>
                )}
              </Link>
            ))}
          </div>
        ))}
      </div>
    </nav>
  );
}
