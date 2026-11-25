import type { SkillImportCandidate } from '@cairn/shared';
import { ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ApiError } from '../api/client.js';
import {
  useApiMutations,
  useCapabilities,
  useGithubConnection,
  useGithubRepos,
  useSkillGithubCandidates,
  useSkillImportCandidates,
} from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { FilterPicker } from '../components/filter-picker.js';
import { FORM_CONTROL_CLS, FormActions, FormField, FormStack } from '../components/form-layout.js';
import { SegmentedTabs } from '../components/segmented.js';
import { Button } from '../components/ui/button.js';
import { Checkbox } from '../components/ui/checkbox.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { FieldError } from '../components/ui/field.js';
import { Input } from '../components/ui/input.js';
import { toastError } from '../components/ui/toaster.js';
import { blockDemoWrite } from '../demo/demo-gate.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { GithubConnectionDeviceDialog } from '../pages/github-connection-device-dialog.js';

type Tab = 'local' | 'github' | 'source';

interface CandidateItem extends SkillImportCandidate {
  subtitle?: string | null;
}

interface ErrorCopy {
  headline: string;
  detail: string;
}

const PROBLEM_COPY: Record<NonNullable<SkillImportCandidate['problem']>, string> = {
  'missing-name': 'SKILL.md 缺少名称',
  'invalid-name': '名称不能用作目录名',
  'missing-description': 'SKILL.md 缺少描述',
};

function serverErrorCopy(err: unknown, t: (s: string) => string): ErrorCopy {
  if (err instanceof ApiError) {
    if (err.status === 409) {
      return { headline: t('同名技能已存在——先处理现有技能，再重新导入。'), detail: err.message };
    }
    if (err.status === 400) {
      return { headline: t('来源未通过校验。'), detail: err.message };
    }
    if (err.status === 502 || err.status === 504) {
      return { headline: t('拉取来源失败——稍后重试。'), detail: err.message };
    }
    return { headline: t('导入失败，请重试。'), detail: err.message };
  }
  return { headline: t('导入失败，请重试。'), detail: '' };
}

function ErrorLine({ error }: { error: ErrorCopy }) {
  return (
    <FieldError>
      {error.headline}
      {error.detail !== '' && (
        <span className="mt-0.5 block text-content-tertiary">{error.detail}</span>
      )}
    </FieldError>
  );
}

function importable(c: SkillImportCandidate): boolean {
  return !c.alreadyImported && c.problem === null;
}

function addableCandidates(
  candidates: SkillImportCandidate[],
  selected: Set<string>,
): SkillImportCandidate[] {
  const taken = new Set(candidates.filter((c) => selected.has(c.sourcePath)).map((c) => c.id));
  const out: SkillImportCandidate[] = [];
  for (const c of candidates) {
    if (!importable(c) || selected.has(c.sourcePath) || taken.has(c.id)) continue;
    taken.add(c.id);
    out.push(c);
  }
  return out;
}

function CandidateList({
  candidates,
  selected,
  failed,
  onToggle,
  onSelectAll,
}: {
  candidates: CandidateItem[];
  selected: Set<string>;
  failed: Map<string, ErrorCopy>;
  onToggle: (c: SkillImportCandidate) => void;
  onSelectAll: (all: boolean) => void;
}) {
  const { t } = useI18n();
  const selectedIds = new Set(
    candidates.filter((c) => selected.has(c.sourcePath)).map((c) => c.id),
  );
  const shownSelected = candidates.some((c) => selected.has(c.sourcePath));
  const addable = addableCandidates(candidates, selected);
  return (
    <div
      data-testid="skill-candidates"
      className="max-h-80 overflow-y-auto rounded-md border border-border bg-card dark:bg-input/30"
    >
      <label
        htmlFor="skill-candidate-all"
        className="sticky top-0 z-[1] flex cursor-pointer items-center gap-3 border-b border-border bg-card px-3 py-2 text-ui text-foreground has-disabled:cursor-default dark:bg-popover"
      >
        <Checkbox
          id="skill-candidate-all"
          data-testid="skill-candidate-all"
          checked={shownSelected && addable.length === 0}
          indeterminate={shownSelected && addable.length > 0}
          disabled={!shownSelected && addable.length === 0}
          onCheckedChange={() => onSelectAll(addable.length > 0)}
          aria-label={t('全选')}
        />
        {t('全选')}
      </label>
      {candidates.map((c, index) => {
        const checkboxId = `skill-candidate-${index}`;
        const checked = selected.has(c.sourcePath);
        const reason = c.alreadyImported
          ? t('已导入')
          : c.problem !== null
            ? t(PROBLEM_COPY[c.problem])
            : !checked && selectedIds.has(c.id)
              ? t('已勾选另一个同名技能')
              : null;
        const error = failed.get(c.sourcePath);
        return (
          <label
            key={c.sourcePath}
            htmlFor={checkboxId}
            data-testid="skill-candidate"
            data-skill-id={c.id}
            className="flex cursor-pointer items-start gap-3 border-b border-border px-3 py-2 last:border-b-0 has-disabled:cursor-default"
          >
            <Checkbox
              id={checkboxId}
              className="mt-0.5"
              checked={checked}
              disabled={reason !== null}
              onCheckedChange={() => onToggle(c)}
              aria-label={c.id}
            />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex items-baseline gap-2">
                <span className="truncate text-ui text-foreground">{c.id}</span>
                {c.subtitle != null && c.subtitle !== '' && (
                  <span className="truncate font-mono text-caption text-content-tertiary">
                    {c.subtitle}
                  </span>
                )}
                {reason !== null && (
                  <span className="shrink-0 text-meta text-content-tertiary">{reason}</span>
                )}
              </span>
              {c.description !== null && (
                <span className="line-clamp-2 text-meta text-content-secondary">
                  {c.description}
                </span>
              )}
              {error !== undefined && <ErrorLine error={error} />}
            </span>
          </label>
        );
      })}
    </div>
  );
}

export function SkillImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const fixture = resolveScenario(searchParams);
  const { live, teamId } = useLiveData();
  const mutations = useApiMutations(teamId);
  const [tab, setTab] = useState<Tab>('local');
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState<ErrorCopy | null>(null);
  const [query, setQuery] = useState('');
  const [githubQuery, setGithubQuery] = useState('');
  const [githubRepo, setGithubRepo] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [deviceOpen, setDeviceOpen] = useState(false);
  const [fixtureAuth, setFixtureAuth] = useState<boolean | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [failed, setFailed] = useState<Map<string, ErrorCopy>>(new Map());
  const [importing, setImporting] = useState(false);
  const candidatesQ = useSkillImportCandidates(teamId, open && live && tab === 'local');
  const githubSelected = open && tab === 'github';
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
  const login = live ? connectionQ.data?.login : fixture.github?.login;
  const reposQ = useGithubRepos(live && githubSelected && connected);
  const repos = live ? (reposQ.data?.repos ?? []) : (fixture.github?.repos ?? []);
  const grantReposUrl = live
    ? (reposQ.data?.grantReposUrl ?? null)
    : (fixture.github?.grantReposUrl ?? null);
  const githubCandidatesQ = useSkillGithubCandidates(
    teamId,
    githubRepo,
    live && githubSelected && connected && githubRepo !== '',
  );

  useEffect(() => {
    if (!open) {
      setSource(null);
      setError(null);
      setQuery('');
      setGithubQuery('');
      setGithubRepo('');
      setPickerOpen(false);
      setDeviceOpen(false);
      setFixtureAuth(null);
      setSelected(new Set());
      setFailed(new Map());
      setTab('local');
      return;
    }
    setSource('');
  }, [open]);

  const switchTab = (next: Tab) => {
    setTab(next);
    setSelected(new Set());
    setFailed(new Map());
    setError(null);
  };

  const candidates = candidatesQ.data?.candidates ?? [];
  const needle = query.trim().toLowerCase();
  const shown =
    needle === ''
      ? candidates
      : candidates.filter(
          (c) =>
            c.id.toLowerCase().includes(needle) ||
            (c.description ?? '').toLowerCase().includes(needle),
        );

  const githubCandidates: CandidateItem[] = (githubCandidatesQ.data?.candidates ?? []).map((c) => ({
    id: c.id,
    description: c.description,
    sourcePath: c.url,
    subtitle: c.path === '' ? null : c.path,
    alreadyImported: c.alreadyImported,
    problem: c.problem,
  }));
  const githubNeedle = githubQuery.trim().toLowerCase();
  const shownGithub =
    githubNeedle === ''
      ? githubCandidates
      : githubCandidates.filter(
          (c) =>
            c.id.toLowerCase().includes(githubNeedle) ||
            (c.subtitle ?? '').toLowerCase().includes(githubNeedle) ||
            (c.description ?? '').toLowerCase().includes(githubNeedle),
        );

  const activeShown = tab === 'local' ? shown : shownGithub;

  const trimmedSource = source?.trim() ?? '';
  const sourceFilled = trimmedSource !== '';
  const busy = importing || mutations.importSkill.isPending;
  const submittable =
    !busy && (tab === 'local' || tab === 'github' ? selected.size > 0 : sourceFilled);

  const toggle = (c: SkillImportCandidate) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(c.sourcePath)) next.delete(c.sourcePath);
      else next.add(c.sourcePath);
      return next;
    });

  const selectAll = (all: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (all) for (const c of addableCandidates(activeShown, prev)) next.add(c.sourcePath);
      else for (const c of activeShown) next.delete(c.sourcePath);
      return next;
    });

  const importPicked = async (mode: 'local' | 'github') => {
    setImporting(true);
    const errors = new Map<string, ErrorCopy>();
    for (const ref of selected) {
      try {
        await mutations.importSkill.mutateAsync(
          mode === 'local' ? { localPath: ref } : { url: ref },
        );
      } catch (err) {
        errors.set(ref, serverErrorCopy(err, t));
      }
    }
    setImporting(false);
    if (errors.size === 0) {
      onClose();
      return;
    }
    setFailed(errors);
    setSelected(new Set(errors.keys()));
  };

  const startGithubAuth = () => {
    if (live && deviceInstallUrl !== null) {
      setDeviceOpen(true);
    } else if (live) {
      mutations.startGithubOAuth.mutate(undefined, {
        onSuccess: (data) => window.location.assign(data.authorizationUrl),
        onError: (err) => toastError(t('暂时无法连接 GitHub，请稍后重试。'), err),
      });
    } else if (!blockDemoWrite()) {
      setFixtureAuth(true);
    }
  };

  const disconnectGithub = () => {
    setPickerOpen(false);
    setGithubRepo('');
    setSelected(new Set());
    setFailed(new Map());
    if (live) {
      mutations.disconnectGithub.mutate(undefined, {
        onError: (err) => toastError(t('断开连接失败，请重试。'), err),
      });
    } else if (!blockDemoWrite()) {
      setFixtureAuth(false);
    }
  };

  const submit = () => {
    if (!submittable) return;
    if (!live) {
      blockDemoWrite();
      onClose();
      return;
    }
    setError(null);
    if (tab === 'local' || tab === 'github') {
      void importPicked(tab);
      return;
    }
    if (!sourceFilled) return;
    const body = /^https?:\/\//i.test(trimmedSource)
      ? { url: trimmedSource }
      : { localPath: trimmedSource };
    mutations.importSkill.mutate(body, {
      onSuccess: onClose,
      onError: (err) => setError(serverErrorCopy(err, t)),
    });
  };

  const primaryLabel =
    (tab === 'local' || tab === 'github') && selected.size > 0
      ? t('导入 {count} 个', { count: selected.size })
      : t('导入');

  return (
    <>
      <DialogShell
        title={t('导入技能')}
        open={open}
        onClose={onClose}
        size="m"
        footer={
          <FormActions
            className="pt-0"
            primary={{ label: primaryLabel, onClick: submit, disabled: !submittable }}
            secondary={{ label: t('取消'), onClick: onClose }}
          />
        }
      >
        {source === null ? null : (
          <FormStack className="max-w-none">
            <SegmentedTabs
              slide
              value={tab}
              onChange={switchTab}
              options={[
                { value: 'local', label: t('从本机选择'), testId: 'skill-import-tab-local' },
                { value: 'github', label: t('从 GitHub 选择'), testId: 'skill-import-tab-github' },
                { value: 'source', label: t('路径或链接'), testId: 'skill-import-tab-source' },
              ]}
            />
            {tab === 'local' ? (
              <>
                <Input
                  aria-label={t('搜索技能')}
                  className={FORM_CONTROL_CLS}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('搜索技能')}
                />
                {candidatesQ.isError ? (
                  <ErrorLine error={serverErrorCopy(candidatesQ.error, t)} />
                ) : candidatesQ.isPending && live ? null : shown.length === 0 ? (
                  <p
                    data-testid="skill-candidates-empty"
                    className="text-meta text-content-tertiary"
                  >
                    {candidates.length === 0
                      ? t('本机 ~/.agents/skills 和 ~/.claude/skills 里没有技能。')
                      : t('没有匹配的技能。')}
                  </p>
                ) : (
                  <CandidateList
                    candidates={shown}
                    selected={selected}
                    failed={failed}
                    onToggle={toggle}
                    onSelectAll={selectAll}
                  />
                )}
                <p className="text-meta text-content-tertiary">
                  {t('导入会复制一份，原目录不变。')}
                </p>
              </>
            ) : tab === 'github' ? (
              connectionPending ? (
                <p className="text-meta text-content-tertiary">{t('正在检查 GitHub 连接…')}</p>
              ) : !connected ? (
                <div className="flex flex-col gap-2">
                  {!signInOff ? (
                    <Button
                      variant="outline"
                      data-testid="skill-github-connect"
                      className={`${FORM_CONTROL_CLS} w-full`}
                      onClick={startGithubAuth}
                    >
                      {t('认证 GitHub')}
                    </Button>
                  ) : null}
                  <p className="text-meta text-content-tertiary">
                    {signInOff
                      ? t('当前实例未配置 GitHub 授权，可切到「路径或链接」粘贴公开仓库地址。')
                      : t('也可以切到「路径或链接」直接粘贴公开仓库地址。')}
                  </p>
                </div>
              ) : (
                <>
                  <FilterPicker
                    open={pickerOpen}
                    onOpenChange={setPickerOpen}
                    alwaysFilter
                    loading={live && (reposQ.isPending || reposQ.isError)}
                    options={repos.map((repo) => ({
                      value: repo.full_name,
                      label: repo.full_name,
                    }))}
                    value={githubRepo === '' ? null : githubRepo}
                    onPick={(fullName) => {
                      setGithubRepo(fullName);
                      setGithubQuery('');
                      setSelected(new Set());
                      setFailed(new Map());
                      setError(null);
                      setPickerOpen(false);
                    }}
                    label={t('GitHub 仓库')}
                    placeholder={t('搜索仓库')}
                    filterLabel={t('搜索仓库')}
                    noun={t('仓库')}
                    emptyText={t('没有匹配的仓库')}
                    popupTestId="github-picker"
                    trigger={
                      <Button
                        variant="outline"
                        data-testid="skill-github-repo-picker"
                        className={`${FORM_CONTROL_CLS} w-full justify-between px-2.5 font-normal`}
                      />
                    }
                    triggerContent={
                      <>
                        {githubRepo === '' ? (
                          <span className="text-content-tertiary">{t('选择 GitHub 仓库')}</span>
                        ) : (
                          <span className="truncate">{githubRepo}</span>
                        )}
                        <ChevronDown className="size-4 flex-none" />
                      </>
                    }
                    header={
                      <>
                        <span>
                          {login === undefined || login === ''
                            ? t('已连接')
                            : `${t('已连接')} · ${login}`}
                        </span>
                        <Button
                          variant="link"
                          className="h-auto p-0 text-caption"
                          onClick={disconnectGithub}
                        >
                          {t('断开连接')}
                        </Button>
                      </>
                    }
                    footer={
                      (live && reposQ.isError) || grantReposUrl !== null ? (
                        <>
                          {live && reposQ.isError && (
                            <div className="text-meta text-destructive" role="alert">
                              {t('暂时无法加载 GitHub 仓库列表，请稍后重试。')}
                            </div>
                          )}
                          {grantReposUrl !== null && (
                            <div>
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
                        </>
                      ) : undefined
                    }
                  />
                  {githubRepo !== '' && (
                    <>
                      {githubCandidates.length > 0 && (
                        <Input
                          aria-label={t('搜索技能')}
                          className={FORM_CONTROL_CLS}
                          value={githubQuery}
                          onChange={(event) => setGithubQuery(event.target.value)}
                          placeholder={t('搜索技能')}
                        />
                      )}
                      {githubCandidatesQ.isError ? (
                        <ErrorLine error={serverErrorCopy(githubCandidatesQ.error, t)} />
                      ) : githubCandidatesQ.isPending && live ? (
                        <p
                          data-testid="skill-github-loading"
                          className="text-meta text-content-tertiary"
                        >
                          {t('正在扫描仓库里的技能…')}
                        </p>
                      ) : shownGithub.length === 0 ? (
                        <p
                          data-testid="skill-candidates-empty"
                          className="text-meta text-content-tertiary"
                        >
                          {githubCandidates.length === 0
                            ? t('这个仓库里没有找到 SKILL.md。')
                            : t('没有匹配的技能。')}
                        </p>
                      ) : (
                        <>
                          <CandidateList
                            candidates={shownGithub}
                            selected={selected}
                            failed={failed}
                            onToggle={toggle}
                            onSelectAll={selectAll}
                          />
                          {githubCandidatesQ.data?.truncated === true && (
                            <p className="text-meta text-content-tertiary">
                              {t('仅显示前 50 个技能，其余可切到「路径或链接」指定子目录导入。')}
                            </p>
                          )}
                        </>
                      )}
                    </>
                  )}
                </>
              )
            ) : (
              <>
                <FormField
                  label={t('本地路径或 GitHub 地址')}
                  htmlFor="dlg-skill-import-source"
                  help={t(
                    '填入服务器本机目录路径（需包含 SKILL.md），或以 https:// 开头的 GitHub 公共仓库地址；导入后可刷新。',
                  )}
                >
                  <Input
                    id="dlg-skill-import-source"
                    data-testid="skill-import-source"
                    className={FORM_CONTROL_CLS}
                    value={source}
                    onChange={(event) => setSource(event.target.value)}
                    placeholder={t(
                      '例如 /Users/you/skills/deploy-to-prod 或 https://github.com/owner/repo',
                    )}
                  />
                </FormField>
                {error !== null && <ErrorLine error={error} />}
              </>
            )}
          </FormStack>
        )}
      </DialogShell>
      {deviceOpen && deviceInstallUrl !== null && (
        <GithubConnectionDeviceDialog
          teamId={teamId}
          installUrl={deviceInstallUrl}
          onClose={() => setDeviceOpen(false)}
          onConnected={() => {
            setDeviceOpen(false);
            void connectionQ.refetch();
            void reposQ.refetch();
          }}
        />
      )}
    </>
  );
}
