import {
  KeyRound,
  type LucideIcon,
  MessageCircle,
  Plug,
  Puzzle,
  Server,
  ShieldEllipsis,
  SlidersHorizontal,
  Smartphone,
  User,
  Vault,
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
import { IconTooltip } from '../components/icon-tooltip.js';
import {
  SettingsNav,
  type SettingsNavGroup,
  SettingsTabStrip,
} from '../components/settings/settings-nav.js';
import { SettingsSearch } from '../components/settings/settings-search.js';
import { SettingsMatchProvider, SettingsRows } from '../components/settings-list.js';
import { Button } from '../components/ui/button.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { useTypeToFocus } from '../overlay/hotkeys.js';
import { EmbeddedShell } from '../pages/shell.js';
import { MachinesPage } from '../resources/machines-page.js';
import { McpServersPage } from '../resources/mcp-servers-page.js';
import { ModelRoutingPage } from '../resources/model-routing-page.js';
import { SecretsPage } from '../resources/secrets-page.js';
import { SkillsPage } from '../resources/skills-page.js';
import { VaultPage } from '../resources/vault-page.js';
import { AccountPage } from '../routes/account-page.js';
import { ApiKeysPage } from '../routes/api-keys-page.js';
import { ImConnectionsPage } from '../routes/im-page.js';
import { RemoteAccessPage } from '../routes/remote-access-page.js';
import { safeSetItem } from '../safe-storage.js';
import {
  isSettingsSectionId,
  SETTINGS_HREF,
  SETTINGS_SECTION_STORAGE_KEY,
  type SettingsSectionId,
  storedSettingsSection,
} from './settings-href.js';

function storePickedSection(target: EventTarget): void {
  if (!(target instanceof Element)) return;
  const picked = target.closest('[data-settings-section]')?.getAttribute('data-settings-section');
  if (isSettingsSectionId(picked)) safeSetItem(SETTINGS_SECTION_STORAGE_KEY, picked);
}

interface Section {
  id: SettingsSectionId;
  label: string;
  Icon: LucideIcon;
  keywords?: string[];
  rows?: true;
  element: () => ReactNode;
}

interface Group {
  heading: string | null;
  sections: Section[];
}

const GROUPS: Group[] = [
  {
    heading: null,
    sections: [
      { id: 'account', label: '账号', Icon: User, rows: true, element: () => <AccountPage /> },
    ],
  },
  {
    heading: '模型',
    sections: [
      {
        id: 'routing',
        label: '模型',
        Icon: SlidersHorizontal,
        keywords: [
          'model',
          'coordinator',
          '思考强度',
          'effort',
          'routing',
          '模型路由',
          '服务商',
          'provider',
          '订阅',
          'subscription',
          '用量',
          'quota',
        ],
        element: () => <ModelRoutingPage />,
      },
    ],
  },
  {
    heading: '执行环境',
    sections: [
      {
        id: 'machines',
        label: '执行机',
        Icon: Server,
        keywords: ['runner', 'machine', 'computer'],
        element: () => <MachinesPage />,
      },
      { id: 'skills', label: '技能', Icon: Puzzle, element: () => <SkillsPage /> },
      {
        id: 'mcp',
        label: '应用',
        Icon: Plug,
        keywords: [
          'mcp',
          'composio',
          'mail',
          'email',
          'imap',
          'qq',
          '邮件',
          '邮箱',
          '授权码',
          'gmail',
          'outlook',
        ],
        element: () => <McpServersPage />,
      },
    ],
  },
  {
    heading: '安全',
    sections: [
      {
        id: 'secrets',
        label: '密钥与环境变量',
        Icon: ShieldEllipsis,
        element: () => <SecretsPage />,
      },
      {
        id: 'vault',
        label: '保险库',
        Icon: Vault,
        keywords: ['vault', 'password', 'login', '密码', '登录', '网站', '网站授权'],
        element: () => <VaultPage />,
      },
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
  {
    heading: '消息',
    sections: [
      {
        id: 'im',
        label: '聊天应用',
        Icon: MessageCircle,
        keywords: ['telegram', 'slack', 'im', 'message', '聊天', '微信', 'wechat'],
        element: () => <ImConnectionsPage />,
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
  return t('{online}/{total} 台执行机在线', {
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
  const { search, hash, state } = useLocation();
  const navigate = useNavigate();
  const tabs = useMediaQuery(SETTINGS_TABS_QUERY);
  const [matchLabel, setMatchLabel] = useState<string | null>(null);
  const [toolbarSlot, setToolbarSlot] = useState<HTMLElement | null>(null);
  const machineNote = useMachineNote();
  const titleId = useId();
  const [restoredSection] = useState(() => (sectionParam === '' ? storedSettingsSection() : null));
  const lastShown = useRef<SettingsSectionId | null>(null);
  const movedTo =
    sectionParam === ''
      ? (lastShown.current ?? restoredSection)
      : sectionParam === 'providers' || sectionParam === 'work-routing'
        ? 'routing'
        : sectionParam === 'appearance'
          ? 'account'
          : null;
  const section = SECTIONS.find((s) => s.id === (movedTo ?? sectionParam)) ?? null;
  const shown = section ?? SECTIONS[0];
  useEffect(() => {
    lastShown.current = shown?.id ?? null;
  }, [shown]);
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
  useEffect(() => {
    if (movedTo !== null)
      navigate({ pathname: `${SETTINGS_HREF}/${movedTo}`, search, hash }, { replace: true, state });
  }, [movedTo, navigate, search, hash, state]);
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
      sections={SECTIONS.map((s) => ({
        id: s.id,
        label: t(s.label),
        Icon: s.Icon,
        keywords: s.keywords ?? [],
      }))}
      onPick={(pick) => {
        safeSetItem(SETTINGS_SECTION_STORAGE_KEY, pick.section);
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
          <IconTooltip
            label={t('关闭设置')}
            side="bottom"
            trigger={
              <Button
                variant="ghost"
                size="icon-sm"
                className="pointer-coarse:-mr-2 pointer-coarse:size-11"
                onClick={onClose}
              />
            }
          >
            <X />
          </IconTooltip>
        </header>
        <div className="flex min-h-0 flex-auto">
          {!tabs && (
            <div
              onClickCapture={(event) => {
                setMatchLabel(null);
                storePickedSection(event.target);
              }}
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
                onClickCapture={(event) => {
                  setMatchLabel(null);
                  storePickedSection(event.target);
                }}
                className="flex flex-none flex-col gap-2 pt-3"
              >
                <div className="px-4">{searchField}</div>
                <SettingsTabStrip groups={groups} current={shown?.id ?? null} hrefFor={hrefFor} />
              </div>
            )}
            {shown !== undefined && (
              <div className="flex flex-none items-center gap-3 px-4 pt-4 pb-3">
                <h2
                  data-testid="settings-head"
                  className="m-0 min-w-0 truncate text-card-title font-semibold text-foreground"
                >
                  {t(shown.label)}
                </h2>
                <div ref={setToolbarSlot} className="-my-1.5 ml-auto flex flex-none items-center" />
              </div>
            )}
            <div data-testid="settings-body" className="flex min-h-0 flex-auto">
              <SettingsMatchProvider value={matchLabel}>
                <EmbeddedShell.Provider value={{ toolbarSlot }}>{body}</EmbeddedShell.Provider>
              </SettingsMatchProvider>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
