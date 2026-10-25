import {
  type CreateProjectBody,
  FS_PICK_ERROR_COPY,
  type FsPickErrorReason,
  type GithubRepoSummary,
  isGithubRepoRef,
  LOCAL_ERROR_REASON_COPY,
  type LocalErrorReason,
} from '@cairn/shared';
import { type KeyboardEvent, type Ref, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ApiError } from '../api/client.js';
import { useApiMutations, useGithubConnection, useGithubRepos } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { FORM_CONTROL_CLS, FormActions, FormField, FormStack } from '../components/form-layout.js';
import { Button } from '../components/ui/button.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu.js';
import { Input } from '../components/ui/input.js';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover.js';
import { toastError } from '../components/ui/toaster.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { oauthReasonCopy } from '../i18n/oauth-reason.js';
import { useI18n } from '../i18n/provider.js';
import { Check, ChevronRight, ImageFrame } from '../icons/index.js';
import { DirBrowser } from './dir-browser.js';
import { PageShell } from './shell.js';

const REPO_TRIGGER_CLS = `${FORM_CONTROL_CLS} flex-1 justify-between px-2.5 font-normal`;

const REPO_INPUT_CLS = `${FORM_CONTROL_CLS} flex-1`;

const FIELD_NOTE_CLS = 'text-meta';

const PICKER_PLATE_CLS = 'w-[calc(var(--anchor-width)+40px)] min-w-[220px]';

const GH_ROW_CLS =
  'h-auto w-full cursor-pointer justify-start px-2 py-1.5 text-left font-normal whitespace-normal outline-hidden focus:bg-accent focus:text-accent-foreground focus-visible:border-transparent focus-visible:ring-0';

const GH_LINK_CLS = 'h-auto p-0 text-meta';

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
    <DropdownMenuTrigger
      render={
        <Button
          ref={buttonRef}
          variant="outline"
          size="icon"
          className={`${FORM_CONTROL_CLS} ml-2 shrink-0 text-content-tertiary`}
          aria-label={label}
        />
      }
    >
      <ChevronRight width={14} height={14} />
    </DropdownMenuTrigger>
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
  const [repoQuery, setRepoQuery] = useState('');
  const [fixtureAuth, setFixtureAuth] = useState<boolean | null>(null);
  const autoName = useRef('');
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
  const connectionPending = live && githubSelected && connectionQ.isPending;
  const connected = live
    ? (connectionQ.data?.connected ?? false)
    : (fixtureAuth ?? fixture.github?.connected === true);
  const login = live ? connectionQ.data?.login : fixture.github?.login;
  const reposQ = useGithubRepos(live && githubSelected && connected && !manualRepo);
  const repos = live ? (reposQ.data?.repos ?? []) : (fixture.github?.repos ?? []);
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
    if (isGithubRepoRef(ref)) backfillName(ref.slice(ref.indexOf('/') + 1));
  };
  const onLocalPathChange = (value: string) => {
    setLocalPath(value);
    setPickHint(null);
    backfillName(pathBasename(value));
  };

  const browseFolder = () => {
    if (pickBusy) return;
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
    if (live) {
      mutations.startGithubOAuth.mutate(undefined, {
        onSuccess: (data) => window.location.assign(data.authorizationUrl),
        onError: (err) => setOauthError(err.message),
      });
    } else {
      setFixtureAuth(true);
    }
  };

  const disconnect = () => {
    setPickerOpen(false);
    if (live) {
      mutations.disconnectGithub.mutate(undefined, {
        onError: (error) => toastError(t('断开连接失败，请重试。'), error),
      });
    } else {
      setFixtureAuth(false);
    }
  };

  const formOk =
    repoSel === 'github'
      ? isGithubRepoRef(githubRepo.trim())
      : repoSel === 'local'
        ? localPath.trim() !== ''
        : true;
  const showGithubField = githubSelected && !manualRepo;

  const pickerVisible = showGithubField && connected && pickerOpen;
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
    const body: CreateProjectBody =
      repoSel === 'github'
        ? { name: name.trim(), kind: 'github', githubRepo: githubRepo.trim() }
        : repoSel === 'local'
          ? { name: name.trim(), kind: 'local', localPath: localPath.trim() }
          : { name: name.trim() };
    if (repoSel === 'local') setSubmittedPath(localPath.trim());
    mutations.createProject.mutate(body, {
      onSuccess: (p) => navigate(`/app/project/${p.id}`),
      onError: (error) => {
        const inlineHandled =
          repoSel === 'local' && error instanceof ApiError && error.status === 400;
        if (!inlineHandled) toastError(t('创建项目失败，请重试。'), error);
      },
    });
  };

  return (
    <PageShell route="project-new" fixture={fixture} selected="none" title={t('新建项目')}>
      <FormStack>
        <div className="flex items-center gap-4">
          <span className="prj-new-avatar flex size-14 flex-none items-center justify-center rounded-full bg-card text-content-tertiary ring-1 ring-border">
            <ImageFrame />
          </span>
          <span className="text-meta text-content-tertiary">
            {t('可选。未设置时以首字母代替。')}
          </span>
        </div>
        <FormField label={t('项目名称')} htmlFor="prj-new-name">
          <Input
            id="prj-new-name"
            type="text"
            className={FORM_CONTROL_CLS}
            placeholder="My App"
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
                  manualRepo ? (
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
                      <RepoSwapButton label={t('选择仓库')} buttonRef={swapBtnRef} />
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
                      <RepoSwapButton label={t('选择仓库')} buttonRef={swapBtnRef} />
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
                        <ChevronRight width={14} height={14} />
                      </PopoverTrigger>
                      <RepoSwapButton label={t('选择仓库')} buttonRef={swapBtnRef} />
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
                      <RepoSwapButton label={t('选择仓库')} buttonRef={swapBtnRef} />
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
                      <DirBrowser
                        onPick={(path) => {
                          setBrowseOpen(false);
                          onLocalPathChange(path);
                        }}
                      />
                    </Popover>
                    <RepoSwapButton label={t('选择仓库')} buttonRef={swapBtnRef} />
                  </>
                ) : (
                  <DropdownMenuTrigger
                    render={
                      <Button variant="outline" id="prj-new-repo" className={REPO_TRIGGER_CLS} />
                    }
                  >
                    <span className="text-content-tertiary">{t('选择仓库')}</span>
                    <ChevronRight width={14} height={14} />
                  </DropdownMenuTrigger>
                )}
                <DropdownMenuContent
                  anchor={repoFieldRef}
                  sideOffset={6}
                  aria-label={t('仓库')}
                  className="w-auto min-w-[200px]"
                >
                  <DropdownMenuRadioGroup
                    value={repoSel === 'none' ? null : repoSel}
                    onValueChange={(next) => {
                      const sel = next as 'github' | 'local';
                      pendingSwapFocus.current = true;
                      setRepoSel(sel);
                      if (sel === 'github') setPickerOpen(false);
                    }}
                  >
                    <DropdownMenuRadioItem value="github" closeOnClick>
                      {t('GitHub 仓库')}
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="local" closeOnClick>
                      {t('本地文件夹')}
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
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
                              <Check width={14} height={14} />
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
                  <Button
                    variant="ghost"
                    className={GH_ROW_CLS}
                    onClick={() => {
                      setPickerOpen(false);
                      setManualRepo(true);
                    }}
                  >
                    {t('手动输入 owner/repo')}
                  </Button>
                </PopoverContent>
              </div>
            </Popover>
          </DropdownMenu>
          {showGithubField && oauthError !== null && (
            <div className={`${FIELD_NOTE_CLS} text-destructive`} role="alert">
              {oauthError}
            </div>
          )}
          {showGithubField && !connected && !connectionPending && (
            <div>
              <Button variant="link" className={GH_LINK_CLS} onClick={() => setManualRepo(true)}>
                {t('手动输入 owner/repo')}
              </Button>
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
                '单机器形态：这台机器损坏时进度随机器走。需要在任意机器上续跑，请用 GitHub 接入。',
              )}
            </div>
          )}
        </FormField>
        <FormActions
          primary={{
            label: t('创建项目'),
            disabled: live ? name.trim() === '' || !formOk : true,
            onClick: live ? submit : undefined,
          }}
        />
      </FormStack>
    </PageShell>
  );
}
