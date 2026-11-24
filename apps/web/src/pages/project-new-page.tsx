import {
  type CreateProjectBody,
  FS_PICK_ERROR_COPY,
  type FsPickErrorReason,
  type GithubRepoSummary,
  githubRepoInputToRef,
  LOCAL_ERROR_REASON_COPY,
  type LocalErrorReason,
  type ProjectIcon,
  projectIconOrAuto,
} from '@cairn/shared';
import { cn } from 'cn';
import { type KeyboardEvent, type Ref, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ApiError } from '../api/client.js';
import {
  useApiMutations,
  useCapabilities,
  useGithubConnection,
  useGithubRepos,
} from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { projectCreationBlocked, setupOpenStep } from '../board/first-run-checklist-model.js';
import { SETUP_HREF, useFirstRunSetup } from '../board/first-run-setup.js';
import { PROJECT_ICON_COMPONENTS } from '../board/project-icon-map.js';
import { ProjectIconPicker } from '../board/project-icon-picker.js';
import { FORM_CONTROL_CLS, FormActions, FormField, FormStack } from '../components/form-layout.js';
import { noteCreatedHere } from '../components/growth.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { KeyedMenuContent, KeyedMenuRadioItem } from '../components/menu-keys.js';
import { Button } from '../components/ui/button.js';
import {
  DropdownMenu,
  DropdownMenuRadioGroup,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu.js';
import { Input } from '../components/ui/input.js';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover.js';
import { toastError } from '../components/ui/toaster.js';
import { blockDemoWrite } from '../demo/demo-gate.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { oauthReasonCopy } from '../i18n/oauth-reason.js';
import { useI18n } from '../i18n/provider.js';
import { ArrowUpDown, Check, ChevronDown } from '../icons/index.js';
import { RouteDialog } from '../overlay/route-dialog.js';
import { DirBrowser } from './dir-browser.js';
import { GithubConnectionDeviceDialog } from './github-connection-device-dialog.js';

const REPO_TRIGGER_CLS = `${FORM_CONTROL_CLS} flex-1 justify-between px-2.5 font-normal`;

const REPO_INPUT_CLS = `${FORM_CONTROL_CLS} flex-1`;

const FIELD_NOTE_CLS = 'text-meta';

const PICKER_PLATE_CLS = 'w-[calc(var(--anchor-width)+40px)] min-w-[220px]';

const GH_ROW_CLS =
  'h-auto w-full pointer-coarse:min-h-11 cursor-pointer justify-start px-2 py-1.5 text-left font-normal whitespace-normal outline-hidden focus:bg-accent focus:text-accent-foreground focus-visible:border-transparent focus-visible:ring-0';

type RepoSel = 'none' | 'github' | 'local';

function pathBasename(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (trimmed === '') return '';
  const segment = trimmed.slice(trimmed.lastIndexOf('/') + 1);
  return segment === '.' || segment === '..' ? '' : segment;
}

function RepoSwapButton({
  label,
  buttonRef,
}: {
  label: string;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <IconTooltip
      label={label}
      trigger={
        <DropdownMenuTrigger
          render={
            <Button
              ref={buttonRef}
              variant="outline"
              size="icon"
              className={`${FORM_CONTROL_CLS} ml-2 shrink-0 text-content-tertiary pointer-coarse:size-11`}
            />
          }
        />
      }
    >
      <ArrowUpDown width={16} height={16} />
    </IconTooltip>
  );
}

export function ProjectNewPage() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const fixture = resolveScenario(searchParams);
  const { live, teamId } = useLiveData();
  const navigate = useNavigate();
  const mutations = useApiMutations(teamId);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<ProjectIcon | null>(null);
  const [repoSel, setRepoSel] = useState<RepoSel>('none');
  const [githubRepo, setGithubRepo] = useState('');
  const [localPath, setLocalPath] = useState('');
  const [pickBusy, setPickBusy] = useState(false);
  const [pickHint, setPickHint] = useState<string | null>(null);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [repoOpen, setRepoOpen] = useState(false);
  const [manualRepo, setManualRepo] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [deviceOpen, setDeviceOpen] = useState(false);
  const [repoQuery, setRepoQuery] = useState('');
  const [fixtureAuth, setFixtureAuth] = useState<boolean | null>(null);
  const autoName = useRef('');
  const nameRef = useRef<HTMLInputElement>(null);
  const repoFieldRef = useRef<HTMLDivElement>(null);
  const swapBtnRef = useRef<HTMLButtonElement>(null);
  const pendingSwapFocus = useRef(false);
  useEffect(() => {
    if (!pendingSwapFocus.current) return;
    pendingSwapFocus.current = false;
    const raf = requestAnimationFrame(() => swapBtnRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [repoSel]);

  useEffect(() => {
    const oauth = searchParams.get('oauth');
    if (oauth === null || searchParams.get('github') !== 'connection') return;
    setRepoSel('github');
    setManualRepo(false);
    if (oauth === 'connected') {
      setOauthError(null);
      setPickerOpen(true);
    } else {
      setOauthError(oauthReasonCopy(searchParams.get('reason'), t));
    }
    const next = new URLSearchParams(searchParams);
    next.delete('oauth');
    next.delete('reason');
    next.delete('github');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, t]);

  const githubSelected = repoSel === 'github';
  const connectionQ = useGithubConnection(teamId, live && githubSelected);
  const capabilitiesQ = useCapabilities(live && githubSelected);
  const connectionPending =
    live && githubSelected && (connectionQ.isPending || capabilitiesQ.isPending);
  const connected = live
    ? (connectionQ.data?.connected ?? false)
    : (fixtureAuth ?? fixture.github?.connected === true);
  const deviceInstallUrl = capabilitiesQ.data?.githubDeviceInstallUrl ?? null;
  const signInOff =
    live &&
    !connectionPending &&
    !connected &&
    deviceInstallUrl === null &&
    capabilitiesQ.data?.githubOAuth !== true;
  const manualEntry = manualRepo || signInOff;
  const login = live ? connectionQ.data?.login : fixture.github?.login;
  const disconnectReason = live ? (connectionQ.data?.disconnectReason ?? null) : null;
  const reposQ = useGithubRepos(live && githubSelected && connected && !manualRepo);
  const repos = live ? (reposQ.data?.repos ?? []) : (fixture.github?.repos ?? []);
  const grantReposUrl = live
    ? (reposQ.data?.grantReposUrl ?? null)
    : (fixture.github?.grantReposUrl ?? null);
  const query = repoQuery.trim().toLowerCase();
  const hits =
    query === '' ? repos : repos.filter((r) => r.full_name.toLowerCase().includes(query));

  const backfillName = (next: string) => {
    if (next === '') return;
    if (name !== '' && name !== autoName.current) return;
    setName(next);
    autoName.current = next;
  };
  const onGithubRepoChange = (value: string) => {
    setGithubRepo(value);
    const ref = value.trim();
    const normalized = githubRepoInputToRef(ref);
    if (normalized !== null) backfillName(normalized.slice(normalized.indexOf('/') + 1));
  };
  const onLocalPathChange = (value: string) => {
    setLocalPath(value);
    setPickHint(null);
    backfillName(pathBasename(value));
  };

  const browseFolder = () => {
    if (pickBusy || blockDemoWrite()) return;
    setPickBusy(true);
    setPickHint(null);
    mutations.pickLocalFolder.mutate(undefined, {
      onSuccess: (data) => {
        if (data.path !== null) onLocalPathChange(data.path);
      },
      onError: (err) => {
        const reason = err instanceof ApiError ? err.reason : undefined;
        setPickHint(
          reason !== undefined && reason in FS_PICK_ERROR_COPY
            ? t(FS_PICK_ERROR_COPY[reason as FsPickErrorReason])
            : err instanceof ApiError
              ? err.message
              : t('无法打开系统文件夹对话框'),
        );
        if (reason === 'unavailable') setBrowseOpen(true);
      },
      onSettled: () => setPickBusy(false),
    });
  };

  const pickRepo = (repo: GithubRepoSummary) => {
    setGithubRepo(repo.full_name);
    backfillName(repo.name);
    setPickerOpen(false);
    setOauthError(null);
  };

  const startAuth = () => {
    setOauthError(null);
    if (live && deviceInstallUrl !== null) {
      setDeviceOpen(true);
    } else if (live) {
      mutations.startGithubOAuth.mutate(undefined, {
        onSuccess: (data) => window.location.assign(data.authorizationUrl),
        onError: () => setOauthError(t('暂时无法连接 GitHub，请稍后重试。')),
      });
    } else if (!blockDemoWrite()) {
      setFixtureAuth(true);
    }
  };

  const disconnect = () => {
    setPickerOpen(false);
    if (live) {
      mutations.disconnectGithub.mutate(undefined, {
        onError: (error) => toastError(t('断开连接失败，请重试。'), error),
      });
    } else if (!blockDemoWrite()) {
      setFixtureAuth(false);
    }
  };

  const formOk =
    repoSel === 'github'
      ? githubRepoInputToRef(githubRepo.trim()) !== null
      : repoSel === 'local'
        ? localPath.trim() !== ''
        : true;
  const showGithubField = githubSelected && !manualEntry;

  const pickerVisible = showGithubField && connected && pickerOpen;
  const refetchRepos = reposQ.refetch;
  useEffect(() => {
    if (pickerVisible && live) void refetchRepos();
  }, [pickerVisible, live, refetchRepos]);
  const ghListRef = useRef<HTMLDivElement>(null);
  const ghFocusDelivered = useRef(false);
  const ghTypeBuf = useRef({ text: '', ts: 0 });
  const [ghActive, setGhActive] = useState(0);
  useEffect(() => {
    if (!pickerVisible) {
      ghFocusDelivered.current = false;
      return;
    }
    let raf = 0;
    let tries = 0;
    const step = () => {
      tries += 1;
      const list = ghListRef.current;
      if (list !== null) {
        const plate = list.closest('[data-testid="github-picker"]');
        const active = document.activeElement;
        if (plate?.contains(active)) {
          ghFocusDelivered.current = true;
          return;
        }
        if (ghFocusDelivered.current && active !== document.body) return;
        const rows = [...list.querySelectorAll<HTMLButtonElement>('[role="option"]')];
        if (rows.length > 0) {
          const idx = Math.max(
            0,
            hits.findIndex((repo) => repo.full_name === githubRepo),
          );
          setGhActive(idx);
          rows[idx]?.focus();
          ghFocusDelivered.current = true;
          return;
        }
      }
      if (tries < 30) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [pickerVisible, hits, githubRepo]);
  const pickerWasOpen = useRef(false);
  useEffect(() => {
    if (pickerVisible) {
      pickerWasOpen.current = true;
      return;
    }
    if (!pickerWasOpen.current) return;
    pickerWasOpen.current = false;
    let raf = 0;
    let tries = 0;
    const step = () => {
      tries += 1;
      const active = document.activeElement;
      const insidePicker = active?.closest('[data-testid="github-picker"]') != null;
      if (active !== document.body && !insidePicker) return;
      const el = document.getElementById('prj-new-repo');
      if (el !== null) {
        el.focus();
        return;
      }
      if (tries < 30) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [pickerVisible]);
  const onGhListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = ghListRef.current;
    if (list === null) return;
    const rows = [...list.querySelectorAll<HTMLButtonElement>('[role="option"]')];
    if (rows.length === 0) return;
    const current = rows.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | null = null;
    if (event.key === 'ArrowDown') {
      next = current < 0 ? 0 : (current + 1) % rows.length;
    } else if (event.key === 'ArrowUp') {
      next = current < 0 ? rows.length - 1 : (current - 1 + rows.length) % rows.length;
    } else if (event.key === 'Home') {
      next = 0;
    } else if (event.key === 'End') {
      next = rows.length - 1;
    } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const now = Date.now();
      const text =
        now - ghTypeBuf.current.ts < 500
          ? ghTypeBuf.current.text + event.key.toLowerCase()
          : event.key.toLowerCase();
      ghTypeBuf.current = { text, ts: now };
      const label = (el: HTMLElement) => (el.textContent ?? '').trim().toLowerCase();
      let idx = rows.findIndex((el) => label(el).startsWith(text));
      if (idx < 0) idx = rows.findIndex((el) => label(el).includes(text));
      if (idx >= 0) next = idx;
    }
    if (next === null) return;
    event.preventDefault();
    setGhActive(next);
    rows[next]?.focus();
  };

  const setup = useFirstRunSetup();
  const blockedStep =
    setup.progress !== undefined && projectCreationBlocked(setup)
      ? setupOpenStep(setup.progress)
      : null;
  const [submittedPath, setSubmittedPath] = useState<string | null>(null);
  const createError = mutations.createProject.error;
  const localErrorCopy = (reason: string | undefined, message: string): string =>
    reason !== undefined && reason in LOCAL_ERROR_REASON_COPY
      ? t(LOCAL_ERROR_REASON_COPY[reason as LocalErrorReason])
      : message;
  const localErrorText =
    repoSel === 'local' &&
    submittedPath !== null &&
    submittedPath === localPath.trim() &&
    createError instanceof ApiError &&
    createError.status === 400
      ? localErrorCopy(createError.reason, createError.message)
      : null;

  const submit = () => {
    if (blockDemoWrite()) return;
    const body: CreateProjectBody =
      repoSel === 'github'
        ? {
            name: name.trim(),
            kind: 'github',
            githubRepo: githubRepoInputToRef(githubRepo.trim()) ?? githubRepo.trim(),
          }
        : repoSel === 'local'
          ? { name: name.trim(), kind: 'local', localPath: localPath.trim() }
          : { name: name.trim() };
    if (repoSel === 'local') setSubmittedPath(localPath.trim());
    mutations.createProject.mutate(body, {
      onSuccess: (p) => {
        noteCreatedHere(p.id);
        if (icon !== null) {
          mutations.patchProject.mutate(
            { id: p.id, body: { icon } },
            { onError: (error) => toastError(t('图标未能保存，请在项目设置里重试。'), error) },
          );
        }
        navigate(`/app/project/${p.id}`);
      },
      onError: (error) => {
        const inlineHandled =
          repoSel === 'local' && error instanceof ApiError && error.status === 400;
        if (!inlineHandled) toastError(t('创建项目失败，请重试。'), error);
      },
    });
  };

  if (blockedStep !== null) {
    return (
      <RouteDialog title={t('新建项目')} size="form">
        <FormStack>
          <p
            data-testid="project-new-blocked"
            className="m-0 text-pretty text-ui text-content-secondary"
          >
            {blockedStep === 'models'
              ? t('建项目前要先把模型配好，还差第 1 步：接入模型。')
              : t('建项目前要先把模型配好，还差第 2 步：确认模型。')}
          </p>
          <FormActions primary={{ label: t('去完成设置'), onClick: () => navigate(SETUP_HREF) }} />
        </FormStack>
      </RouteDialog>
    );
  }

  return (
    <RouteDialog title={t('新建项目')} size="form" initialFocus={nameRef}>
      <FormStack>
        <span className="flex size-14 flex-none overflow-hidden rounded-full bg-card text-content-tertiary ring-1 ring-border">
          <ProjectIconPicker
            icon={icon}
            color={null}
            onChange={(patch) => setIcon(patch.icon ?? null)}
            triggerClassName="grid place-items-center rounded-full"
            trigger={<NewProjectIcon icon={icon} name={name} />}
          />
        </span>
        <FormField label={t('项目名称')} htmlFor="prj-new-name">
          <Input
            ref={nameRef}
            id="prj-new-name"
            type="text"
            className={FORM_CONTROL_CLS}
            placeholder={t('例如：我的应用')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </FormField>
        <FormField label={t('仓库')} htmlFor="prj-new-repo">
          <DropdownMenu
            open={repoOpen}
            onOpenChange={(next) => {
              setRepoOpen(next);
              if (next) setPickerOpen(false);
            }}
          >
            <Popover
              open={pickerVisible}
              onOpenChange={(next: boolean) => {
                if (next) {
                  setRepoOpen(false);
                  setPickerOpen(true);
                } else {
                  setPickerOpen(false);
                }
              }}
            >
              <div className="relative flex" ref={repoFieldRef}>
                {repoSel === 'github' ? (
                  manualEntry ? (
                    <>
                      <Input
                        id="prj-new-repo"
                        className={REPO_INPUT_CLS}
                        type="text"
                        placeholder="owner/repo"
                        aria-label={t('GitHub 仓库')}
                        value={githubRepo}
                        onChange={(e) => onGithubRepoChange(e.target.value)}
                      />
                      <RepoSwapButton label={t('切换仓库来源')} buttonRef={swapBtnRef} />
                    </>
                  ) : connectionPending ? (
                    <>
                      <Button
                        variant="outline"
                        id="prj-new-repo"
                        className={REPO_TRIGGER_CLS}
                        disabled
                      >
                        <span className="text-content-tertiary">{t('选择仓库')}</span>
                      </Button>
                      <RepoSwapButton label={t('切换仓库来源')} buttonRef={swapBtnRef} />
                    </>
                  ) : connected ? (
                    <>
                      <PopoverTrigger
                        render={
                          <Button
                            variant="outline"
                            id="prj-new-repo"
                            className={REPO_TRIGGER_CLS}
                          />
                        }
                      >
                        {githubRepo === '' ? (
                          <span className="text-content-tertiary">{t('选择 GitHub 仓库')}</span>
                        ) : (
                          <span>{githubRepo}</span>
                        )}
                        <ChevronDown width={16} height={16} />
                      </PopoverTrigger>
                      <RepoSwapButton label={t('切换仓库来源')} buttonRef={swapBtnRef} />
                    </>
                  ) : (
                    <>
                      <Button
                        variant="outline"
                        id="prj-new-repo"
                        className={`${FORM_CONTROL_CLS} flex-1`}
                        onClick={startAuth}
                      >
                        {t('认证 GitHub')}
                      </Button>
                      <RepoSwapButton label={t('切换仓库来源')} buttonRef={swapBtnRef} />
                    </>
                  )
                ) : repoSel === 'local' ? (
                  <>
                    <Input
                      id="prj-new-repo"
                      className={REPO_INPUT_CLS}
                      type="text"
                      placeholder="/path/to/repo"
                      aria-label={t('本地文件夹')}
                      value={localPath}
                      onChange={(e) => onLocalPathChange(e.target.value)}
                    />
                    <Popover
                      open={browseOpen}
                      onOpenChange={(next: boolean) => {
                        if (next) browseFolder();
                        else setBrowseOpen(false);
                      }}
                    >
                      <PopoverTrigger
                        render={
                          <Button
                            variant="outline"
                            className={`${FORM_CONTROL_CLS} ml-2 shrink-0 px-3`}
                            aria-label={t('浏览')}
                            disabled={pickBusy}
                          />
                        }
                      >
                        {t('浏览')}
                      </PopoverTrigger>
                      {browseOpen && (
                        <DirBrowser
                          onPick={(path) => {
                            setBrowseOpen(false);
                            onLocalPathChange(path);
                          }}
                        />
                      )}
                    </Popover>
                    <RepoSwapButton label={t('切换仓库来源')} buttonRef={swapBtnRef} />
                  </>
                ) : (
                  <DropdownMenuTrigger
                    render={
                      <Button variant="outline" id="prj-new-repo" className={REPO_TRIGGER_CLS} />
                    }
                  >
                    <span className="text-content-tertiary">{t('选择仓库')}</span>
                    <ChevronDown width={16} height={16} />
                  </DropdownMenuTrigger>
                )}
                <KeyedMenuContent
                  anchor={repoFieldRef}
                  align={repoSel === 'none' ? 'start' : 'end'}
                  sideOffset={6}
                  aria-label={t('仓库')}
                  className="w-auto min-w-[200px]"
                >
                  <DropdownMenuRadioGroup
                    value={
                      repoSel === 'none'
                        ? null
                        : repoSel === 'github' && manualRepo && !signInOff
                          ? 'manual'
                          : repoSel
                    }
                    onValueChange={(next) => {
                      const sel = next as 'github' | 'manual' | 'local';
                      pendingSwapFocus.current = true;
                      setRepoSel(sel === 'local' ? 'local' : 'github');
                      setManualRepo(sel === 'manual');
                      setPickerOpen(false);
                    }}
                  >
                    <KeyedMenuRadioItem value="github" shortcut="G" closeOnClick>
                      {t('GitHub 仓库')}
                    </KeyedMenuRadioItem>
                    {!signInOff && (
                      <KeyedMenuRadioItem value="manual" shortcut="M" closeOnClick>
                        {t('手动输入 owner/repo')}
                      </KeyedMenuRadioItem>
                    )}
                    <KeyedMenuRadioItem value="local" shortcut="L" closeOnClick>
                      {t('本地文件夹')}
                    </KeyedMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </KeyedMenuContent>
                <PopoverContent
                  side="bottom"
                  align="start"
                  sideOffset={8}
                  initialFocus={false}
                  className={PICKER_PLATE_CLS}
                  data-testid="github-picker"
                >
                  <div className="flex items-center justify-between px-1 text-xs leading-4 text-muted-foreground">
                    <span>
                      {login === undefined || login === ''
                        ? t('已连接')
                        : `${t('已连接')} · ${login}`}
                    </span>
                    <Button variant="link" className="h-auto p-0 text-xs" onClick={disconnect}>
                      {t('断开连接')}
                    </Button>
                  </div>
                  <Input
                    type="text"
                    placeholder={t('搜索仓库')}
                    aria-label={t('搜索仓库')}
                    value={repoQuery}
                    onChange={(e) => setRepoQuery(e.target.value)}
                  />
                  {hits.length === 0 ? (
                    live && reposQ.isPending ? null : (
                      <div className="px-3 py-2 text-xs leading-4 text-muted-foreground">
                        {t('没有匹配的仓库')}
                      </div>
                    )
                  ) : (
                    <div
                      className="flex max-h-56 flex-col overflow-y-auto"
                      role="listbox"
                      aria-label={t('GitHub 仓库')}
                      ref={ghListRef}
                      onKeyDown={onGhListKeyDown}
                    >
                      {hits.map((repo, index) => (
                        <Button
                          key={repo.id}
                          variant="ghost"
                          className={GH_ROW_CLS}
                          role="option"
                          aria-selected={githubRepo === repo.full_name}
                          tabIndex={index === ghActive ? 0 : -1}
                          onClick={() => pickRepo(repo)}
                        >
                          {repo.full_name}
                          {githubRepo === repo.full_name && (
                            <span className="ml-auto flex text-primary">
                              <Check width={16} height={16} />
                            </span>
                          )}
                        </Button>
                      ))}
                    </div>
                  )}
                  {live && reposQ.isError ? (
                    <div className="px-1 text-xs leading-4 text-destructive" role="alert">
                      {(reposQ.error as Error).message}
                    </div>
                  ) : null}
                  {grantReposUrl !== null && (
                    <div className="px-1 text-xs leading-4 text-muted-foreground">
                      {t('只显示已授权给 Cairn 的仓库')}
                      {' · '}
                      <a
                        href={grantReposUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-foreground underline underline-offset-2"
                      >
                        {t('去 GitHub 授权更多仓库')}
                      </a>
                    </div>
                  )}
                </PopoverContent>
              </div>
            </Popover>
          </DropdownMenu>
          {showGithubField && oauthError !== null && (
            <div className={`${FIELD_NOTE_CLS} text-destructive`} role="alert">
              {oauthError}
            </div>
          )}
          {showGithubField && disconnectReason !== null && (
            <div className={`${FIELD_NOTE_CLS} text-destructive`} role="alert">
              {t('GitHub 连接已断开')}：{disconnectReason}
            </div>
          )}
          {localErrorText !== null && (
            <div className={`${FIELD_NOTE_CLS} text-destructive`} role="alert">
              {localErrorText}
            </div>
          )}
          {repoSel === 'local' && pickHint !== null && (
            <div className={`${FIELD_NOTE_CLS} text-content-tertiary`} role="status">
              {pickHint}
            </div>
          )}
          {repoSel === 'local' && (
            <div className={`${FIELD_NOTE_CLS} text-content-tertiary`}>
              {t(
                '单执行机形态：这台执行机损坏时进度随之丢失。需要在任意执行机上继续运行，请用 GitHub 接入。',
              )}
            </div>
          )}
        </FormField>
        <FormActions
          hint={live ? undefined : t('演示数据不能新建项目')}
          primary={{
            label: t('创建项目'),
            disabled: live ? name.trim() === '' || !formOk : true,
            onClick: live ? submit : undefined,
          }}
        />
      </FormStack>
      {deviceOpen && deviceInstallUrl !== null && (
        <GithubConnectionDeviceDialog
          teamId={teamId}
          installUrl={deviceInstallUrl}
          onClose={() => setDeviceOpen(false)}
          onConnected={() => {
            setDeviceOpen(false);
            setPickerOpen(true);
          }}
        />
      )}
    </RouteDialog>
  );
}

function NewProjectIcon({ icon, name }: { icon: ProjectIcon | null; name: string }) {
  const resolved = projectIconOrAuto(icon, name);
  const auto = icon === null && resolved !== 'box';
  const Icon = PROJECT_ICON_COMPONENTS[resolved];
  return (
    <Icon
      data-project-icon={icon !== null || auto ? resolved : undefined}
      data-project-icon-auto={auto || undefined}
      className={cn('size-5', resolved === 'box' ? 'text-content-tertiary' : 'text-foreground')}
    />
  );
}
