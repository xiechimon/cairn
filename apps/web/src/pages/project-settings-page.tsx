import { isGithubRepoRef } from '@cairn/shared';
import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useApiMutations, useProjects } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { ProjectAvatar } from '../board/project-avatar.js';
import { FORM_CONTROL_CLS } from '../components/form-layout.js';
import {
  SETTINGS_HINT_CLS,
  SETTINGS_SELECT_TRIGGER_CLS,
  SettingsCard,
  SettingsDangerZone,
  SettingsHeader,
  SettingsRow,
} from '../components/settings-list.js';
import { Button } from '../components/ui/button.js';
import { DIALOG_PRIMARY_BUTTON } from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import { toastError } from '../components/ui/toaster.js';
import { isDeleted, markDeleted } from '../fixtures/deletions.js';
import type { ProjectContent } from '../fixtures/records.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { ChevronDown, SquarePen } from '../icons/index.js';
import { DeleteProjectConfirm } from '../overlay/delete-project-confirm.js';
import { ProjectAutonomyCard } from './project-autonomy-card.js';
import { PageShell, TabGroup } from './shell.js';

const TABS = [
  { id: 'basic', label: '基本信息' },
  { id: 'repo', label: '仓库' },
  { id: 'tags', label: '标签' },
];

const ROW_INPUT_CLS = `${FORM_CONTROL_CLS} w-72`;
const ROW_ICON_CLS = 'text-content-tertiary';
export function ProjectSettingsPage() {
  const { t } = useI18n();
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fixture = resolveScenario(searchParams);
  const [tab, setTab] = useState('basic');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [accelDraft, setAccelDraft] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [descDraft, setDescDraft] = useState<string | null>(null);
  const [convRepo, setConvRepo] = useState('');
  const [convPathDraft, setConvPathDraft] = useState<string | null>(null);
  const [convError, setConvError] = useState<string | null>(null);
  const [repoDraft, setRepoDraft] = useState<string | null>(null);
  const [repoError, setRepoError] = useState<string | null>(null);
  const { live, teamId } = useLiveData();
  const projectsQ = useProjects(teamId, live);
  const mutations = useApiMutations(teamId);
  const wireProject = live ? (projectsQ.data ?? []).find((p) => p.id === id) : undefined;
  const project: ProjectContent | undefined = live
    ? wireProject
      ? {
          name: wireProject.name,
          branch: 'main',
          files: [],
          repoName: wireProject.repoName ?? wireProject.githubRepo ?? wireProject.localPath ?? '',
          hosted: wireProject.repoKind === 'hosted',
          defaultBranch: 'main',
          description: wireProject.description ?? null,
        }
      : undefined
    : fixture.project;
  const rowIds = live
    ? (projectsQ.data ?? []).map((p) => p.id)
    : Object.keys(fixture.projectNames ?? {});
  const tone = Math.max(0, rowIds.filter((pid) => !isDeleted(pid)).indexOf(id ?? ''));
  const repoKind = live ? wireProject?.repoKind : project?.hosted ? 'hosted' : project?.repoKind;
  const kindLabel =
    repoKind === 'hosted'
      ? t('Cairn 托管')
      : repoKind === 'github'
        ? t('GitHub 仓库')
        : repoKind === 'local'
          ? t('本地文件夹')
          : undefined;
  return (
    <PageShell
      route="project-settings"
      fixture={fixture}
      selected="none"
      title={t('设置')}
      back={{ pathname: `/app/project/${id ?? ''}`, search: searchParams.toString() }}
    >
      <div className="flex flex-col gap-4">
        <SettingsHeader
          avatarClassName="prj-set-avatar"
          avatar={
            <ProjectAvatar
              name={project?.name ?? ''}
              tone={tone}
              className="size-14 rounded-none text-page"
            />
          }
          title={project?.name ?? ''}
          sub={kindLabel}
        />
        <div className="flex">
          <TabGroup tabs={TABS} tab={tab} onTab={setTab} />
        </div>
        <SettingsCard className="prj-set-card">
          <SettingsRow label={t('名称')}>
            {live && wireProject !== undefined ? (
              <>
                <Input
                  aria-label={t('名称')}
                  className={ROW_INPUT_CLS}
                  value={nameDraft ?? wireProject.name}
                  onChange={(event) => setNameDraft(event.target.value)}
                />
                <Button
                  className={DIALOG_PRIMARY_BUTTON}
                  aria-label={t('保存名称')}
                  disabled={
                    mutations.patchProject.isPending ||
                    (nameDraft ?? '').trim() === wireProject.name ||
                    (nameDraft ?? '').trim() === ''
                  }
                  onClick={() => {
                    if (id === undefined) return;
                    mutations.patchProject.mutate(
                      { id, body: { name: (nameDraft ?? '').trim() } },
                      {
                        onSuccess: () => setNameDraft(null),
                        onError: (error) => toastError(t('保存失败，请重试。'), error),
                      },
                    );
                  }}
                >
                  {t('保存')}
                </Button>
              </>
            ) : (
              <>
                {project?.name ?? ''}
                <SquarePen width={14} height={14} className={ROW_ICON_CLS} />
              </>
            )}
          </SettingsRow>
          {live && wireProject?.repoKind === 'github' ? (
            <SettingsRow label={t('仓库')}>
              <Input
                aria-label={t('GitHub 仓库（owner/repo）')}
                className={`${ROW_INPUT_CLS} font-mono`}
                placeholder="owner/repo"
                value={repoDraft ?? wireProject.githubRepo ?? ''}
                onChange={(event) => {
                  setRepoDraft(event.target.value);
                  setRepoError(null);
                }}
              />
              <Button
                className={DIALOG_PRIMARY_BUTTON}
                aria-label={t('保存仓库')}
                disabled={
                  mutations.patchProject.isPending ||
                  (repoDraft ?? wireProject.githubRepo ?? '').trim() ===
                    (wireProject.githubRepo ?? '').trim() ||
                  (repoDraft ?? '').trim() === ''
                }
                onClick={() => {
                  if (id === undefined) return;
                  const repo = (repoDraft ?? '').trim();
                  if (!isGithubRepoRef(repo)) {
                    setRepoError(t('GitHub 仓库格式应为 owner/repo。'));
                    return;
                  }
                  mutations.patchProject.mutate(
                    { id, body: { githubRepo: repo } },
                    {
                      onSuccess: () => {
                        setRepoDraft(null);
                        setRepoError(null);
                      },
                      onError: (error) => toastError(t('仓库保存失败，请重试。'), error),
                    },
                  );
                }}
              >
                {t('保存')}
              </Button>
              {repoError !== null && (
                <span role="alert" className="text-meta text-destructive">
                  {repoError}
                </span>
              )}
            </SettingsRow>
          ) : (
            <SettingsRow label={t('仓库')}>{project?.repoName ?? ''}</SettingsRow>
          )}
          <SettingsRow label={t('目标分支')}>
            <span
              className={`prj-set-branch inline-flex w-32 items-center justify-between border px-2.5 font-mono ${SETTINGS_SELECT_TRIGGER_CLS}`}
            >
              {project?.defaultBranch ?? 'main'}
              <ChevronDown width={14} height={14} className={ROW_ICON_CLS} />
            </span>
          </SettingsRow>
          {live && wireProject?.repoKind === 'github' && (
            <SettingsRow label={t('本机加速路径')}>
              <Input
                aria-label={t('本机加速路径')}
                className={`${ROW_INPUT_CLS} font-mono`}
                placeholder={t('绝对路径，留空即清除')}
                value={accelDraft ?? wireProject.localPath ?? ''}
                onChange={(event) => setAccelDraft(event.target.value)}
              />
              <Button
                className={DIALOG_PRIMARY_BUTTON}
                disabled={
                  mutations.patchProject.isPending ||
                  (accelDraft ?? wireProject.localPath ?? '') === (wireProject.localPath ?? '')
                }
                onClick={() => {
                  if (id === undefined) return;
                  const next = (accelDraft ?? '').trim();
                  mutations.patchProject.mutate(
                    { id, body: { localPath: next === '' ? null : next } },
                    {
                      onSuccess: () => setAccelDraft(null),
                      onError: (error) => toastError(t('保存失败，请重试。'), error),
                    },
                  );
                }}
              >
                {t('保存')}
              </Button>
            </SettingsRow>
          )}
          <SettingsRow
            label={t('描述')}
            valueClassName={
              live || project?.description != null ? undefined : 'text-content-tertiary'
            }
          >
            {live && wireProject !== undefined ? (
              <>
                <Input
                  aria-label={t('描述')}
                  className={ROW_INPUT_CLS}
                  placeholder={t('尚无描述')}
                  value={descDraft ?? wireProject.description ?? ''}
                  onChange={(event) => setDescDraft(event.target.value)}
                />
                <Button
                  className={DIALOG_PRIMARY_BUTTON}
                  aria-label={t('保存描述')}
                  disabled={
                    mutations.patchProject.isPending ||
                    (descDraft ?? wireProject.description ?? '') === (wireProject.description ?? '')
                  }
                  onClick={() => {
                    if (id === undefined) return;
                    const next = (descDraft ?? '').trim();
                    mutations.patchProject.mutate(
                      { id, body: { description: next === '' ? null : next } },
                      {
                        onSuccess: () => setDescDraft(null),
                        onError: (error) => toastError(t('描述保存失败，请重试。'), error),
                      },
                    );
                  }}
                >
                  {t('保存')}
                </Button>
              </>
            ) : (
              <>
                {project?.description ?? t('尚无描述')}
                <SquarePen width={14} height={14} className={ROW_ICON_CLS} />
              </>
            )}
          </SettingsRow>
        </SettingsCard>
        {live && wireProject?.repoKind === 'local' && (
          <SettingsCard>
            <div className="flex flex-col gap-3 p-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-ui font-medium text-foreground">
                  {t('转换为 GitHub 形态')}
                </span>
                <span className={SETTINGS_HINT_CLS}>
                  {t(
                    '转换后以 GitHub 仓为唯一真值源，本机路径转为执行加速位；有在飞构建时不可转换。',
                  )}
                </span>
              </div>
              <Input
                aria-label={t('GitHub 仓库（owner/repo）')}
                className={`${ROW_INPUT_CLS} font-mono`}
                placeholder="owner/repo"
                value={convRepo}
                onChange={(event) => {
                  setConvRepo(event.target.value);
                  setConvError(null);
                }}
              />
              <Input
                aria-label={t('本机加速路径')}
                className={`${ROW_INPUT_CLS} font-mono`}
                placeholder={t('绝对路径，留空即清除')}
                value={convPathDraft ?? wireProject.localPath ?? ''}
                onChange={(event) => setConvPathDraft(event.target.value)}
              />
              <div className="flex items-center gap-3">
                <Button
                  className={DIALOG_PRIMARY_BUTTON}
                  disabled={mutations.patchProject.isPending || convRepo.trim() === ''}
                  onClick={() => {
                    if (id === undefined) return;
                    const repo = convRepo.trim();
                    if (!isGithubRepoRef(repo)) {
                      setConvError(t('GitHub 仓库格式应为 owner/repo。'));
                      return;
                    }
                    const nextPath = (convPathDraft ?? wireProject.localPath ?? '').trim();
                    mutations.patchProject.mutate(
                      {
                        id,
                        body: {
                          repoKind: 'github',
                          githubRepo: repo,
                          localPath: nextPath === '' ? null : nextPath,
                        },
                      },
                      {
                        onSuccess: () => {
                          setConvRepo('');
                          setConvPathDraft(null);
                          setConvError(null);
                        },
                        onError: (error) => toastError(t('转换失败，请重试。'), error),
                      },
                    );
                  }}
                >
                  {t('转换')}
                </Button>
                {convError !== null && (
                  <span role="alert" className="text-meta text-destructive">
                    {convError}
                  </span>
                )}
              </div>
            </div>
          </SettingsCard>
        )}
        {live && wireProject?.repoKind === 'github' && id !== undefined && teamId !== undefined && (
          <ProjectAutonomyCard projectId={id} teamId={teamId} />
        )}
        <section className="flex flex-col gap-2">
          <h3 className="m-0 px-1 text-meta font-normal text-content-tertiary">{t('危险操作')}</h3>
          <SettingsDangerZone
            className="prj-set-danger"
            label={t('删除项目')}
            description={t(
              '删除项目将级联删除其下所有任务、构建历史、定时任务、标签与托管仓库文件，此操作不可恢复。',
            )}
            actionLabel={t('删除')}
            onAction={() => setDeleteOpen(true)}
          />
        </section>
      </div>
      <DeleteProjectConfirm
        projectName={project?.name ?? ''}
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => {
          setDeleteOpen(false);
          if (live) {
            if (id !== undefined) {
              mutations.deleteProject.mutate(id, {
                onSuccess: () => navigate('/app'),
                onError: (error) => toastError(t('删除项目失败，请重试。'), error),
              });
            }
            return;
          }
          if (id !== undefined) markDeleted(id);
          navigate('/app');
        }}
      />
    </PageShell>
  );
}
