import { Button } from '../components/ui/button.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu.js';
import type { PaneView } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { ChevronDown } from '../icons/index.js';

export type PaneRowLabel = '方案' | '变更' | '分支与 PR' | 'Token 用量' | '运行历史';

export type DocTypeLabel = '方案' | '变更';

const SECTION_ROWS: Array<{ view: PaneView; label: PaneRowLabel }> = [
  { view: 'branch', label: '分支与 PR' },
  { view: 'token', label: 'Token 用量' },
  { view: 'history', label: '运行历史' },
];

const DROPDOWN_PANEL_LAYOUT = 'min-w-[220px]';

export function PaneTypeSelect({
  view,
  docLabel,
  sections,
  onView,
  initiallyOpen,
}: {
  view: PaneView;
  docLabel: DocTypeLabel;
  sections?: boolean;
  onView: (view: PaneView) => void;
  initiallyOpen?: boolean;
}) {
  const { t } = useI18n();
  const rows: Array<{ view: PaneView; label: PaneRowLabel }> = [
    { view: 'doc', label: docLabel },
    ...(sections ? SECTION_ROWS : []),
  ];
  const label: PaneRowLabel =
    view === 'doc'
      ? docLabel
      : (SECTION_ROWS.find((row) => row.view === view)?.label ?? '分支与 PR');
  return (
    <span className="doc-select-wrap relative flex">
      <DropdownMenu defaultOpen={initiallyOpen}>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="xs" className="doc-pane-select ml-1.5" />}
        >
          {t(label)}
          <ChevronDown width={12} height={12} />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          side="bottom"
          sideOffset={8}
          aria-label={t('面板视图')}
          className={DROPDOWN_PANEL_LAYOUT}
        >
          <DropdownMenuRadioGroup value={view} onValueChange={(next) => onView(next as PaneView)}>
            {rows.map((row) => (
              <DropdownMenuRadioItem key={row.view} value={row.view} closeOnClick>
                {t(row.label)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}
