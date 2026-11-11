import { cn } from 'cn';
import {
  Archive,
  ArrowLeft,
  KeyRound,
  Layers,
  type LucideIcon,
  Palette,
  Plug,
  Puzzle,
  Route,
  Server,
  ShieldEllipsis,
  Smartphone,
  User,
  Waypoints,
  X,
} from 'lucide-react';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Link, type To, useLocation, useSearchParams } from 'react-router';
import { useMachines } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { SettingsNav, type SettingsNavGroup } from '../components/settings/settings-nav.js';
import { SettingsCard, SettingsRow, SettingsSegmented } from '../components/settings-list.js';
import { Button } from '../components/ui/button.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
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
import { applyTheme, readStoredTheme, type Theme } from '../theme.js';
import { ArchivedProjectsSection } from './archived-projects-section.js';
import { SETTINGS_HREF, type SettingsSectionId } from './settings-href.js';

interface Section {
  id: SettingsSectionId;
  label: string;
  Icon: LucideIcon;
  element: () => ReactNode;
}

interface Group {
  heading: string | null;
  sections: Section[];
}

function AppearanceSection() {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme(safeLocalStorage()));
  return (
    <PageShell
      route={`${SETTINGS_HREF}/appearance`}
      title={t('外观')}
      fixture={resolveScenario(searchParams)}
    >
      <SettingsCard>
        <SettingsRow label={t('颜色主题')} hint={t('只影响这台设备')}>
          <SettingsSegmented
            label={t('外观')}
            value={theme}
            onChange={(next) => {
              applyTheme(next);
              setTheme(next);
            }}
            options={[
              { value: 'light', label: t('浅色') },
              { value: 'dark', label: t('深色') },
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
      { id: 'account', label: '账号', Icon: User, element: () => <AccountPage /> },
      { id: 'appearance', label: '外观', Icon: Palette, element: () => <AppearanceSection /> },
      {
        id: 'projects',
        label: '项目',
        Icon: Archive,
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
      { id: 'api-keys', label: 'API 密钥', Icon: KeyRound, element: () => <ApiKeysPage /> },
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

function useMachineBadge(): string | undefined {
  const [searchParams] = useSearchParams();
  const { live, teamId } = useLiveData();
  const machinesQ = useMachines(teamId, live);
  const rows = live
    ? (machinesQ.data ?? []).map((m) => m.online)
    : (resolveScenario(searchParams).resources?.machines ?? []).map((m) => m.online === true);
  if (rows.length === 0) return undefined;
  return `${rows.filter(Boolean).length}/${rows.length}`;
}

const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.closest('input, textarea, select') !== null)
  );
}

function trapTab(event: ReactKeyboardEvent<HTMLElement>): void {
  if (event.key !== 'Tab' || !event.currentTarget.contains(event.target as Node)) return;
  const tabbable = [...event.currentTarget.querySelectorAll<HTMLElement>(TABBABLE)].filter(
    (el) => el.offsetParent !== null,
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
  const [query, setQuery] = useState('');
  const machineBadge = useMachineBadge();
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
    const onSlash = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditable(event.target)) return;
      const input = searchRef.current;
      if (input === null || input.offsetParent === null) return;
      event.preventDefault();
      input.focus();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('keydown', onSlash);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('keydown', onSlash);
    };
  }, []);
  const hrefFor = (id: string): To => ({ pathname: `${SETTINGS_HREF}/${id}`, search });
  const groups: SettingsNavGroup[] = GROUPS.map((group) => ({
    heading: group.heading === null ? null : t(group.heading),
    items: group.sections.map((s) => ({
      id: s.id,
      label: t(s.label),
      Icon: s.Icon,
      ...(s.id === 'machines' && machineBadge !== undefined ? { badge: machineBadge } : {}),
    })),
  }));
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
        className="fixed inset-0 z-(--z-panel-low) flex overflow-hidden bg-background text-ui text-foreground outline-none md:inset-auto md:top-1/2 md:left-1/2 md:h-[min(40rem,calc(100%-3rem))] md:w-[min(56rem,calc(100%-3rem))] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-(--radius-card) md:shadow-(--e3) md:ring-1 md:ring-border"
      >
        <div
          className={cn(
            'w-full flex-none bg-(--surface-1) md:w-48 md:border-r md:border-border',
            section !== null && 'max-md:hidden',
          )}
        >
          <SettingsNav
            groups={groups}
            current={shown?.id ?? null}
            hrefFor={hrefFor}
            query={query}
            onQuery={setQuery}
            searchRef={searchRef}
            top={
              <div className="flex items-center justify-between px-2">
                <span id={titleId} className="text-meta text-content-tertiary">
                  {t('设置')}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="md:hidden"
                  aria-label={t('关闭设置')}
                  onClick={onClose}
                >
                  <X />
                </Button>
              </div>
            }
          />
        </div>
        <div
          data-testid="settings-content"
          className={cn('flex min-w-0 flex-auto flex-col', section === null && 'max-md:hidden')}
        >
          <div
            data-testid="settings-head"
            className="flex h-12 flex-none items-center gap-2 px-4 md:pl-5"
          >
            <Button
              variant="ghost"
              size="icon-sm"
              className="-ml-2 md:hidden"
              aria-label={t('返回设置')}
              render={<Link to={{ pathname: SETTINGS_HREF, search }} replace />}
            >
              <ArrowLeft />
            </Button>
            {shown !== undefined && (
              <h1 className="m-0 min-w-0 flex-1 truncate text-card-title font-semibold text-foreground">
                {t(shown.label)}
              </h1>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              className="ml-auto max-md:hidden"
              aria-label={t('关闭设置')}
              onClick={onClose}
            >
              <X />
            </Button>
          </div>
          <div data-testid="settings-body" className="flex min-h-0 flex-auto">
            {shown !== undefined && (
              <EmbeddedShell.Provider value>{shown.element()}</EmbeddedShell.Provider>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
