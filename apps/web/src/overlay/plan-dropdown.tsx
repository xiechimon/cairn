import { cn } from 'cn';
import { KeyedMenuContent, KeyedMenuItem } from '../components/menu-keys.js';
import { Button } from '../components/ui/button.js';
import { DropdownMenu, DropdownMenuTrigger } from '../components/ui/dropdown-menu.js';
import { useI18n } from '../i18n/provider.js';
import { ChevronDown, DiffSquare, FileText } from '../icons/index.js';

export type DocTypeLabel = '方案' | '变更';
export type DocView = 'plan' | 'changes';

const VIEWS: Array<{ view: DocView; label: DocTypeLabel; shortcut: string }> = [
  { view: 'plan', label: '方案', shortcut: 'P' },
  { view: 'changes', label: '变更', shortcut: 'C' },
];

export function PaneTitle({
  docLabel,
  onDocView,
}: {
  docLabel: DocTypeLabel;
  onDocView: (view: DocView) => void;
}) {
  const { t } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-testid="pane-title"
        className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-ui font-semibold text-(--foreground) outline-none hover:bg-(--menu-hover) focus-visible:ring-2 focus-visible:ring-(--ring) aria-expanded:bg-(--menu-hover)"
      >
        {t(docLabel)}
        <ChevronDown width={12} height={12} className="text-(--text-tertiary)" />
      </DropdownMenuTrigger>
      <KeyedMenuContent align="start" side="bottom" sideOffset={4} className="w-36">
        {VIEWS.map(({ view, label, shortcut }) => (
          <KeyedMenuItem key={view} shortcut={shortcut} onClick={() => onDocView(view)}>
            {t(label)}
          </KeyedMenuItem>
        ))}
      </KeyedMenuContent>
    </DropdownMenu>
  );
}

export function PaneViewButtons({
  docLabel,
  onDocView,
}: {
  docLabel: DocTypeLabel;
  onDocView: (view: DocView) => void;
}) {
  const { t } = useI18n();
  const active: DocView = docLabel === '变更' ? 'changes' : 'plan';
  return (
    <fieldset
      aria-label={t('面板视图')}
      className="m-0 flex min-w-0 items-center gap-0.5 border-0 p-0"
    >
      {VIEWS.map(({ view, label }) => (
        <Button
          key={view}
          variant="ghost"
          size="icon-xs"
          data-testid={`pane-view-${view}`}
          aria-label={t(label)}
          aria-pressed={active === view}
          title={t(label)}
          onClick={() => onDocView(view)}
          className={cn(
            'size-6.5 rounded-md text-(--text-tertiary) hover:bg-(--menu-hover) hover:text-(--foreground)',
            active === view && 'bg-(--menu-hover) text-(--foreground)',
          )}
        >
          {view === 'plan' ? (
            <FileText width={15} height={15} />
          ) : (
            <DiffSquare width={15} height={15} />
          )}
        </Button>
      ))}
    </fieldset>
  );
}
