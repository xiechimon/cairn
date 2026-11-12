import { cn } from 'cn';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  type ComponentType,
  Fragment,
  type ReactNode,
  type SVGProps,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Link, type To } from 'react-router';
import { useI18n } from '../../i18n/provider.js';
import { IconTooltip } from '../icon-tooltip.js';
import { Button } from '../ui/button.js';

export interface SettingsNavItem {
  id: string;
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  note?: string;
}

export interface SettingsNavGroup {
  heading: string | null;
  items: SettingsNavItem[];
}

export function SettingsNav({
  groups,
  current,
  hrefFor,
  search,
}: {
  groups: SettingsNavGroup[];
  current: string | null;
  hrefFor: (id: string) => To;
  search: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <nav aria-label={t('设置分区')} className="flex h-full min-h-0 flex-col gap-3 px-4 py-4">
      {search}
      <div className="flex min-h-0 flex-auto flex-col overflow-y-auto">
        {groups.map((group, index) => (
          <Fragment key={group.heading ?? group.items[0]?.id}>
            {index > 0 && (
              <hr aria-hidden className="mx-3 my-3.5 flex-none border-0 border-t border-border" />
            )}
            <div className="flex flex-col gap-0.5">
              {group.heading !== null && <span className="sr-only">{group.heading}</span>}
              {group.items.map((item) => (
                <Link
                  key={item.id}
                  to={hrefFor(item.id)}
                  replace
                  data-settings-section={item.id}
                  title={item.note}
                  aria-description={item.note}
                  aria-current={current === item.id ? 'page' : undefined}
                  className={cn(
                    'flex h-7.75 flex-none items-center gap-3.5 rounded-(--radius-control) px-2.5 text-ui no-underline transition-colors duration-(--dur-fast) outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    current === item.id
                      ? 'bg-(--sidebar-active) text-foreground'
                      : 'text-foreground hover:bg-sidebar-hover',
                  )}
                >
                  <item.Icon aria-hidden className="size-5 flex-none" strokeWidth={1.75} />
                  <span className="min-w-0 flex-auto truncate">{item.label}</span>
                </Link>
              ))}
            </div>
          </Fragment>
        ))}
      </div>
    </nav>
  );
}

export function SettingsTabStrip({
  groups,
  current,
  hrefFor,
}: {
  groups: SettingsNavGroup[];
  current: string | null;
  hrefFor: (id: string) => To;
}) {
  const { t } = useI18n();
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  const items = groups.flatMap((group) => group.items);
  const measure = () => {
    const el = scroller.current;
    if (el === null) return;
    setEdges({
      start: el.scrollLeft > 1,
      end: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
    });
  };
  useEffect(() => {
    measure();
    const el = scroller.current;
    el?.querySelector('[aria-current="page"]')?.scrollIntoView({
      inline: 'center',
      block: 'nearest',
    });
    const observer = new ResizeObserver(measure);
    if (el !== null) observer.observe(el);
    return () => observer.disconnect();
  }, [current]);
  const scrollBy = (direction: 1 | -1) => {
    const el = scroller.current;
    el?.scrollBy({ left: direction * el.clientWidth * 0.7, behavior: 'smooth' });
  };
  return (
    <nav
      aria-label={t('设置分区')}
      className="relative flex h-10 flex-none items-center gap-1 px-4"
    >
      {edges.start && (
        <IconTooltip
          label={t('向左滚动')}
          trigger={
            <Button
              variant="ghost"
              size="icon-sm"
              className="-ml-2 flex-none"
              onClick={() => scrollBy(-1)}
            />
          }
        >
          <ChevronLeft />
        </IconTooltip>
      )}
      <div
        ref={scroller}
        data-testid="settings-tabs"
        onScroll={measure}
        className="flex min-w-0 flex-auto items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((item) => (
          <Link
            key={item.id}
            to={hrefFor(item.id)}
            replace
            data-settings-section={item.id}
            title={item.note}
            aria-description={item.note}
            aria-current={current === item.id ? 'page' : undefined}
            className={cn(
              'flex h-7.75 flex-none items-center gap-1.5 rounded-(--radius-control) px-2.5 text-ui whitespace-nowrap text-foreground no-underline outline-none focus-visible:ring-2 focus-visible:ring-ring',
              current === item.id ? 'bg-(--sidebar-active)' : 'hover:bg-sidebar-hover',
            )}
          >
            {item.label}
          </Link>
        ))}
      </div>
      {edges.end && (
        <IconTooltip
          label={t('向右滚动')}
          trigger={
            <Button
              variant="ghost"
              size="icon-sm"
              className="-mr-2 flex-none"
              onClick={() => scrollBy(1)}
            />
          }
        >
          <ChevronRight />
        </IconTooltip>
      )}
    </nav>
  );
}
