import { cn } from 'cn';
import {
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
  User,
  Users,
  X,
} from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Link, type To, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
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
import { SecretsPage } from '../resources/secrets-page.js';
import { SkillsPage } from '../resources/skills-page.js';
import { AccountPage } from '../routes/account-page.js';
import { ApiKeysPage } from '../routes/api-keys-page.js';
import { TeamPage } from '../routes/team-page.js';
import { safeLocalStorage } from '../safe-storage.js';
import { applyTheme, readStoredTheme, type Theme } from '../theme.js';
import {
  rememberSettingsReturn,
  SETTINGS_HREF,
  type SettingsSectionId,
  settingsReturn,
} from './settings-href.js';

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
    ],
  },
  {
    heading: '模型与账户',
    sections: [
      { id: 'providers', label: '模型服务', Icon: Layers, element: () => <ProvidersPage /> },
      { id: 'routing', label: '订阅与路由', Icon: Route, element: () => <ModelRoutingPage /> },
    ],
  },
  {
    heading: '执行环境',
    sections: [
      { id: 'machines', label: '机器', Icon: Server, element: () => <MachinesPage /> },
      { id: 'skills', label: '技能', Icon: Puzzle, element: () => <SkillsPage /> },
      { id: 'mcp', label: 'MCP', Icon: Plug, element: () => <McpServersPage /> },
      { id: 'secrets', label: '密钥', Icon: ShieldEllipsis, element: () => <SecretsPage /> },
    ],
  },
  {
    heading: '团队与访问',
    sections: [
      { id: 'team', label: '团队', Icon: Users, element: () => <TeamPage /> },
      { id: 'api-keys', label: 'API 密钥', Icon: KeyRound, element: () => <ApiKeysPage /> },
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

export function SettingsPage() {
  const { t } = useI18n();
  const { section: sectionParam } = useParams();
  const { search, state } = useLocation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const machineBadge = useMachineBadge();
  const section = SECTIONS.find((s) => s.id === sectionParam) ?? null;
  const shown = section ?? SECTIONS[0];
  const [returnTo] = useState(() => {
    const from =
      typeof state === 'object' &&
      state !== null &&
      'returnTo' in state &&
      typeof state.returnTo === 'string'
        ? state.returnTo
        : settingsReturn();
    const scenario = new URLSearchParams(search).get('scenario');
    return from ?? `/app${scenario === null ? '' : `?scenario=${scenario}`}`;
  });
  useEffect(() => rememberSettingsReturn(returnTo), [returnTo]);
  const linkState = { returnTo };
  const close = () => {
    rememberSettingsReturn(null);
    navigate(returnTo);
  };
  const windowRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    windowRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector('[data-open]') !== null) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.closest('input, textarea, select') !== null)
      ) {
        return;
      }
      closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
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
      <div aria-hidden className="h-full bg-(--surface-1)" />
      <div
        aria-hidden
        data-testid="settings-backdrop"
        className="fixed inset-0 z-(--z-backdrop-low) bg-(--overlay-scrim)"
        onClick={close}
      />
      <div
        ref={windowRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('设置')}
        tabIndex={-1}
        className="fixed inset-0 z-(--z-panel-low) flex overflow-hidden bg-background text-ui outline-none md:top-6 md:bottom-6 md:left-[max(1.5rem,calc(50%-38rem))] md:w-[min(76rem,calc(100%-3rem))] md:rounded-(--radius-card) md:shadow-(--e3) md:ring-1 md:ring-border"
      >
        <div
          className={cn(
            'w-full flex-none bg-(--surface-1) md:w-60 md:border-r md:border-border',
            section !== null && 'max-md:hidden',
          )}
        >
          <SettingsNav
            groups={groups}
            current={shown?.id ?? null}
            hrefFor={hrefFor}
            query={query}
            onQuery={setQuery}
            linkState={linkState}
            top={
              <div className="flex items-center justify-between px-1 md:hidden">
                <span className="text-card-title font-medium text-foreground">{t('设置')}</span>
                <Button variant="ghost" size="icon-sm" aria-label={t('关闭设置')} onClick={close}>
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
          <div className="flex h-11 flex-none items-center gap-2 border-b border-border px-4 text-meta text-content-tertiary">
            <Button
              variant="ghost"
              size="icon-sm"
              className="md:hidden"
              aria-label={t('返回设置')}
              render={<Link to={{ pathname: SETTINGS_HREF, search }} state={linkState} replace />}
            >
              <ArrowLeft />
            </Button>
            <span>{t('设置')}</span>
            {shown !== undefined && (
              <>
                <span aria-hidden>/</span>
                <span className="text-foreground">{t(shown.label)}</span>
              </>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              className="ml-auto max-md:hidden"
              aria-label={t('关闭设置')}
              onClick={close}
            >
              <X />
            </Button>
          </div>
          <div className="flex min-h-0 flex-auto">
            {shown !== undefined && (
              <EmbeddedShell.Provider value>{shown.element()}</EmbeddedShell.Provider>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
