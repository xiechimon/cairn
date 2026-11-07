import { cn } from 'cn';
import { Search } from 'lucide-react';
import type { ComponentType, ReactNode, Ref, SVGProps } from 'react';
import { Link, type To } from 'react-router';
import { useI18n } from '../../i18n/provider.js';
import { Input } from '../ui/input.js';
import { Kbd } from '../ui/kbd.js';

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
  searchRef,
  top,
}: {
  groups: SettingsNavGroup[];
  current: string | null;
  hrefFor: (id: string) => To;
  query: string;
  onQuery: (next: string) => void;
  searchRef?: Ref<HTMLInputElement>;
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
    <nav aria-label={t('设置分区')} className="flex h-full min-h-0 flex-col gap-3 px-2 py-3">
      {top}
      <div
        data-testid="settings-search"
        className="flex h-8 flex-none items-center gap-2 rounded-(--radius-control) px-2.5 text-content-tertiary transition-colors duration-(--dur-fast) focus-within:bg-sidebar-hover focus-within:ring-1 focus-within:ring-(--focus-ring) hover:bg-sidebar-hover"
      >
        <Search aria-hidden className="size-4 flex-none" strokeWidth={1.75} />
        <Input
          ref={searchRef}
          aria-label={t('搜索设置')}
          aria-keyshortcuts="/"
          className="h-full flex-auto border-0 bg-transparent px-0 py-0 text-ui outline-hidden text-foreground shadow-none placeholder:text-content-secondary focus-visible:border-0 focus-visible:ring-0 md:text-ui dark:bg-transparent"
          placeholder={t('搜索')}
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.stopPropagation();
            onQuery('');
            event.currentTarget.blur();
          }}
        />
        <Kbd
          data-testid="settings-search-hint"
          className="h-5 flex-none bg-transparent px-1.5 text-caption font-normal text-content-tertiary ring-1 ring-border max-md:hidden"
        >
          /
        </Kbd>
      </div>
      <div className="flex min-h-0 flex-auto flex-col gap-4 overflow-y-auto">
        {visible.length === 0 && (
          <p className="m-0 px-2.5 text-meta text-content-tertiary">{t('没有匹配的设置')}</p>
        )}
        {visible.map((group) => (
          <div key={group.heading ?? group.items[0]?.id} className="flex flex-col gap-px">
            {group.heading !== null && (
              <span className="px-2.5 pt-1 pb-1 text-caption font-medium text-content-tertiary">
                {group.heading}
              </span>
            )}
            {group.items.map((item) => (
              <Link
                key={item.id}
                to={hrefFor(item.id)}
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
