import {
  Archive,
  KeyRound,
  Layers,
  type LucideIcon,
  Monitor,
  Moon,
  Palette,
  Plug,
  Puzzle,
  Route,
  Server,
  ShieldEllipsis,
  Smartphone,
  Sun,
  User,
  Waypoints,
  X,
} from 'lucide-react';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { type To, useLocation, useNavigate, useSearchParams } from 'react-router';
import { useMachines } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { useMediaQuery } from '../board/use-narrow.js';
import {
  SettingsNav,
  type SettingsNavGroup,
  SettingsTabStrip,
} from '../components/settings/settings-nav.js';
import { SettingsSearch } from '../components/settings/settings-search.js';
import {
  SettingsCard,
  SettingsMatchProvider,
  SettingsRow,
  SettingsRows,
  SettingsSegmented,
} from '../components/settings-list.js';
import { Button } from '../components/ui/button.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { useTypeToFocus } from '../overlay/hotkeys.js';
import { EmbeddedShell, PageShell } from '../pages/shell.js';
import { MachinesPage } from '../resources/machines-page.js';
import { McpServersPage } from '../resources/mcp-servers-page.js';
import { ModelRoutingPage } from '../resources/model-routing-page.js';
import { ProvidersPage } from '../resources/providers-page.js';
import { RoutingSettingsPage } from '../resources/routing-settings-page.js';
import { SecretsPage } from '../resources/secrets-page.js';
import { SkillsPage } from '../resources/skills-page.js';
import { AccountPage } from '../routes/account-page.js';
import { ApiKeysPage } from '../routes/api-keys-page.js';
import { RemoteAccessPage } from '../routes/remote-access-page.js';
import { safeLocalStorage } from '../safe-storage.js';
import { applyTheme, readStoredTheme, type ThemePreference } from '../theme.js';
import { ArchivedProjectsSection } from './archived-projects-section.js';
import { SETTINGS_HREF, type SettingsSectionId } from './settings-href.js';

interface Section {
  id: SettingsSectionId;
  label: string;
  Icon: LucideIcon;
  rows?: true;
  element: () => ReactNode;
}

interface Group {
  heading: string | null;
  sections: Section[];
}

function AppearanceSection() {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const [theme, setTheme] = useState<ThemePreference>(() => readStoredTheme(safeLocalStorage()));
  return (
    <PageShell
      route={`${SETTINGS_HREF}/appearance`}
      title={t('外观')}
      fixture={resolveScenario(searchParams)}
    >
      <SettingsCard>
        <SettingsRow label={t('颜色主题')}>
          <SettingsSegmented
            label={t('外观')}
            value={theme}
            className="h-7 [&_[data-segmented=option]]:size-6 [&_[data-segmented=option]]:px-0"
            onChange={(next) => {
              applyTheme(next);
              setTheme(next);
            }}
            options={[
              { value: 'system', icon: <Monitor />, ariaLabel: t('跟随系统') },
              { value: 'light', icon: <Sun />, ariaLabel: t('浅色') },
              { value: 'dark', icon: <Moon />, ariaLabel: t('深色') },
            ]}
          />
        </SettingsRow>
      </SettingsCard>
    </PageShell>
  );
}

const GROUPS: Group[] = [
  {
    heading: null,
    sections: [
      { id: 'account', label: '账号', Icon: User, rows: true, element: () => <AccountPage /> },
      {
        id: 'appearance',
        label: '外观',
        Icon: Palette,
        rows: true,
        element: () => <AppearanceSection />,
      },
      {
        id: 'projects',
        label: '项目',
        Icon: Archive,
        rows: true,
        element: () => <ArchivedProjectsSection />,
      },
    ],
  },
  {
    heading: '模型',
    sections: [
      { id: 'providers', label: '模型服务', Icon: Layers, element: () => <ProvidersPage /> },
      { id: 'routing', label: '用量与连接', Icon: Route, element: () => <ModelRoutingPage /> },
      {
        id: 'work-routing',
        label: '规则与策略',
        Icon: Waypoints,
        element: () => <RoutingSettingsPage />,
      },
    ],
  },
  {
    heading: '执行环境',
    sections: [
      { id: 'machines', label: '机器', Icon: Server, element: () => <MachinesPage /> },
      { id: 'skills', label: '技能', Icon: Puzzle, element: () => <SkillsPage /> },
      { id: 'mcp', label: 'MCP', Icon: Plug, element: () => <McpServersPage /> },
    ],
  },
  {
    heading: '安全',
    sections: [
      { id: 'secrets', label: '密钥', Icon: ShieldEllipsis, element: () => <SecretsPage /> },
      {
        id: 'api-keys',
        label: 'API 密钥',
        Icon: KeyRound,
        element: () => <ApiKeysPage />,
      },
      {
        id: 'remote',
        label: '远程访问',
        Icon: Smartphone,
        element: () => <RemoteAccessPage />,
      },
    ],
  },
];

const SECTIONS = GROUPS.flatMap((group) => group.sections);

const SETTINGS_TABS_QUERY = '(max-width: 767px)';

function useMachineNote(): string | undefined {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const { live, teamId } = useLiveData();
  const machinesQ = useMachines(teamId, live);
  const rows = live
    ? (machinesQ.data ?? []).map((m) => m.online)
    : (resolveScenario(searchParams).resources?.machines ?? []).map((m) => m.online === true);
  if (rows.length === 0) return undefined;
  return t('{online}/{total} 台电脑在线', {
    online: rows.filter(Boolean).length,
    total: rows.length,
  });
}

const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const LAYER_ABOVE_SETTINGS =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.closest('input, textarea, select') !== null)
  );
}

function trapTab(event: ReactKeyboardEvent<HTMLElement>): void {
  if (event.key !== 'Tab' || !event.currentTarget.contains(event.target as Node)) return;
  const tabbable = [...event.currentTarget.querySelectorAll<HTMLElement>(TABBABLE)].filter(
    (el) => el.offsetParent !== null && el.tabIndex >= 0,
  );
  const first = tabbable[0];
  const last = tabbable[tabbable.length - 1];
  if (first === undefined || last === undefined) {
    event.preventDefault();
    return;
  }
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === event.currentTarget)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

export function SettingsDialog({
  section: sectionParam,
  onClose,
}: {
  section: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { search } = useLocation();
  const navigate = useNavigate();
  const tabs = useMediaQuery(SETTINGS_TABS_QUERY);
  const [matchLabel, setMatchLabel] = useState<string | null>(null);
  const machineNote = useMachineNote();
  const titleId = useId();
  const section = SECTIONS.find((s) => s.id === sectionParam) ?? null;
  const shown = section ?? SECTIONS[0];
  const opener = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  const popupRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const returnTo = opener.current;
    return () => {
      if (returnTo?.isConnected) returnTo.focus();
    };
  }, []);
  useLayoutEffect(() => {
    popupRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (document.querySelector('[data-open]') !== null) return;
      if (isEditable(event.target)) return;
      closeRef.current();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);
  const searchNow = useCallback(() => {
    const input = searchRef.current;
    return input === null || input.offsetParent === null ? null : input;
  }, []);
  const layerAbove = useCallback(
    () =>
      [...document.querySelectorAll(LAYER_ABOVE_SETTINGS)].some(
        (el) => el !== popupRef.current && el.checkVisibility(),
      ),
    [],
  );
  useTypeToFocus(searchNow, layerAbove);
  const hrefFor = (id: string): To => ({ pathname: `${SETTINGS_HREF}/${id}`, search });
  const groups: SettingsNavGroup[] = GROUPS.map((group) => ({
    heading: group.heading === null ? null : t(group.heading),
    items: group.sections.map((s) => ({
      id: s.id,
      label: t(s.label),
      Icon: s.Icon,
      ...(s.id === 'machines' && machineNote !== undefined ? { note: machineNote } : {}),
    })),
  }));
  const searchField = (
    <SettingsSearch
      inputRef={searchRef}
      sections={SECTIONS.map((s) => ({ id: s.id, label: t(s.label), Icon: s.Icon }))}
      onPick={(pick) => {
        navigate(hrefFor(pick.section), { replace: true });
        setMatchLabel(pick.row);
      }}
    />
  );
  const body =
    shown === undefined ? null : shown.rows ? (
      <SettingsRows>{shown.element()}</SettingsRows>
    ) : (
      shown.element()
    );
  return (
    <>
      <div
        aria-hidden
        data-testid="settings-backdrop"
        className="fixed inset-0 z-(--z-backdrop-low) bg-(--overlay-scrim)"
        onClick={onClose}
      />
      <div
        ref={popupRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={trapTab}
        className="fixed inset-0 z-(--z-panel-low) flex flex-col overflow-hidden bg-dialog-surface pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-ui text-foreground outline-none md:inset-auto md:top-1/2 md:left-1/2 md:h-(--settings-h) md:w-(--settings-w) md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-(--radius-sheet) md:p-0 md:shadow-(--e3)"
      >
        <header
          data-testid="settings-title"
          className="flex h-11 flex-none items-center justify-between gap-2 border-b border-border pr-3 pl-4"
        >
          <h1 id={titleId} className="m-0 text-card-title font-semibold text-foreground">
            {t('设置')}
          </h1>
          <Button variant="ghost" size="icon-sm" aria-label={t('关闭设置')} onClick={onClose}>
            <X />
          </Button>
        </header>
        <div className="flex min-h-0 flex-auto">
          {!tabs && (
            <div
              onClickCapture={() => setMatchLabel(null)}
              className="w-(--settings-nav-w) flex-none border-r border-border"
            >
              <SettingsNav
                groups={groups}
                current={shown?.id ?? null}
                hrefFor={hrefFor}
                search={searchField}
              />
            </div>
          )}
          <div
            data-testid="settings-content"
            onPointerDownCapture={() => setMatchLabel(null)}
            className="flex min-w-0 flex-auto flex-col"
          >
            {tabs && (
              <div
                onClickCapture={() => setMatchLabel(null)}
                className="flex flex-none flex-col gap-2 pt-3"
              >
                <div className="px-4">{searchField}</div>
                <SettingsTabStrip groups={groups} current={shown?.id ?? null} hrefFor={hrefFor} />
              </div>
            )}
            {shown !== undefined && (
              <h2
                data-testid="settings-head"
                className="m-0 flex-none truncate px-4 pt-4 pb-3 text-card-title font-semibold text-foreground"
              >
                {t(shown.label)}
              </h2>
            )}
            <div data-testid="settings-body" className="flex min-h-0 flex-auto">
              <SettingsMatchProvider value={matchLabel}>
                <EmbeddedShell.Provider value>{body}</EmbeddedShell.Provider>
              </SettingsMatchProvider>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
