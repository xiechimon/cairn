import {
  githubRepoInputToRef,
  type ProjectModelChoice,
  type ProjectRecord,
  type TeamRoutingSettings,
} from '@cairn/shared';
import { cn } from 'cn';
import { Archive, ArchiveRestore, BookText, FolderSearch, Settings2 } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { type To, useParams, useSearchParams } from 'react-router';
import { useApiMutations, useModelSources, useProjects } from '../api/hooks.js';
import { toModelOptions } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { useRoutingSettings } from '../api/routing-settings.js';
import { toastArchived } from '../board/archive-toast.js';
import { ProjectAvatar } from '../board/project-avatar.js';
import { ProjectIconPicker } from '../board/project-icon-picker.js';
import { ProjectInstructionsField } from '../board/project-instructions-field.js';
import { ProjectsFailed, ProjectsLoading } from '../board/project-not-found.js';
import { useMediaQuery } from '../board/use-narrow.js';
import { MemoryPanel } from '../chief/memory-panel.js';
import { EmptyState } from '../components/empty-state.js';
import { FORM_CONTROL_CLS } from '../components/form-layout.js';
import {
  SettingsNav,
  type SettingsNavGroup,
  SettingsTabStrip,
} from '../components/settings/settings-nav.js';
import {
  SETTINGS_HINT_CLS,
  SETTINGS_SELECT_TRIGGER_CLS,
  SettingsCard,
  SettingsRow,
  SettingsRows,
} from '../components/settings-list.js';
import { Button } from '../components/ui/button.js';
import { DIALOG_PRIMARY_BUTTON } from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import { Spinner } from '../components/ui/spinner.js';
import { toastError } from '../components/ui/toaster.js';
import { blockDemoWrite } from '../demo/demo-gate.js';
import type { ModelOption, ProjectContent } from '../fixtures/records.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { ChevronDown } from '../icons/index.js';
import { RouteDialog } from '../overlay/route-dialog.js';
import { RuleRow } from '../resources/routing-settings-page.js';
import { ProjectAutonomyCard } from './project-autonomy-card.js';
import { ProjectBaseBranchSelect } from './project-base-branch-select.js';

const SECTIONS = [
  { id: 'general', label: '通用', Icon: Settings2 },
  { id: 'memory', label: '记忆', Icon: BookText },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

const NAV_TABS_QUERY = '(max-width: 767px)';

const ROW_INPUT_CLS = `${FORM_CONTROL_CLS} w-72 min-w-0 max-sm:flex-1`;

const NARROW_ROWS_CLS =
  'max-sm:[&_.settings-row]:flex-wrap max-sm:[&_.settings-row]:py-3 max-sm:[&_.settings-row>span]:w-full max-sm:[&_.settings-row>span]:max-w-full';

const HEAD_CLS = 'm-0 text-ui font-normal text-foreground';

const EMPTY_ROUTING: TeamRoutingSettings = { rules: [], policies: [] };

function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-t border-border pt-5 first:border-t-0 first:pt-1">
      {title !== undefined && <h3 className={HEAD_CLS}>{title}</h3>}
      {children}
    </section>
  );
}

function coordinatorModelLabel(
  settings: TeamRoutingSettings,
  options: readonly ModelOption[],
): string | null {
  const rule = settings.rules.find((r) => r.use === 'coordinator');
  const modelId = rule?.modelId ?? settings.coordinatorDefault?.modelId ?? null;
  if (modelId === null) return null;
  return options.find((o) => o.modelId === modelId)?.modelName ?? modelId;
}

function ProjectModels({
  project,
  live,
  teamId,
}: {
  project: Pick<ProjectRecord, 'id' | 'modelOverrides'> | undefined;
  live: boolean;
  teamId: string | undefined;
}) {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const fixture = resolveScenario(searchParams);
  const routingQ = useRoutingSettings(teamId, live);
  const sourcesQ = useModelSources(teamId, live);
  const mutations = useApiMutations(teamId);
  const settings = live
    ? (routingQ.data ?? EMPTY_ROUTING)
    : (fixture.resources?.routingSettings ?? EMPTY_ROUTING);
  const options = toModelOptions(
    live ? (sourcesQ.data?.sources ?? []) : (fixture.resources?.providerSources ?? []),
  );
  const save = (choice: ProjectModelChoice | null) => {
    if (project === undefined) return;
    if (!live) {
      blockDemoWrite();
      return;
    }
    mutations.patchProject.mutate(
      { id: project.id, body: { modelOverrides: { coordinator: choice } } },
      { onError: (error) => toastError(t('保存失败，请重试。'), error) },
    );
  };
  return (
    <SettingsCard className={NARROW_ROWS_CLS}>
      <RuleRow
        use="coordinator"
        label="Coordinator"
        hint={null}
        testId="project-model-coordinator"
        rule={project?.modelOverrides?.coordinator ?? null}
        options={options}
        followDefault={{
          label: t('跟随团队默认'),
          detail: coordinatorModelLabel(settings, options),
          onPick: () => save(null),
        }}
        onSave={save}
      />
    </SettingsCard>
  );
}

export function ProjectSettingsPage() {
  const { t } = useI18n();
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const fixture = resolveScenario(searchParams);
  const asked = searchParams.get('tab');
  const section: SectionId = asked === 'memory' ? 'memory' : 'general';
  const navTabs = useMediaQuery(NAV_TABS_QUERY);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [accelDraft, setAccelDraft] = useState<string | null>(null);
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
          repoName: wireProject.repoName ?? wireProject.githubRepo ?? wireProject.localPath ?? '',
          hosted: wireProject.repoKind === 'hosted',
          defaultBranch: wireProject.baseBranch ?? '',
          description: wireProject.description ?? null,
          ...(wireProject.icon != null ? { icon: wireProject.icon } : {}),
          ...(wireProject.color != null ? { color: wireProject.color } : {}),
        }
      : undefined
    : id !== undefined && (fixture.projectNames === undefined || id in fixture.projectNames)
      ? fixture.project
      : undefined;
  const missing = live
    ? projectsQ.data !== undefined && wireProject === undefined
    : project === undefined;
  const fieldProject = live
    ? wireProject
    : id === undefined
      ? undefined
      : { id, description: project?.description ?? undefined };
  const memoryProject = live ? wireProject : { id: id ?? '', name: project?.name ?? '' };
  const repoKind = live ? wireProject?.repoKind : project?.hosted ? 'hosted' : project?.repoKind;
  const archived = wireProject?.archivedAt != null;
  const patch = (body: Parameters<typeof mutations.patchProject.mutate>[0]['body']) => {
    if (id === undefined) return;
    if (!live) {
      blockDemoWrite();
      return;
    }
    mutations.patchProject.mutate(
      { id, body },
      { onError: (error) => toastError(t('保存失败，请重试。'), error) },
    );
  };
  const saveName = () => {
    const next = (nameDraft ?? '').trim();
    setNameDraft(null);
    if (nameDraft === null || next === '' || next === project?.name) return;
    patch({ name: next });
  };
  const setArchived = (next: boolean) => {
    if (id === undefined) return;
    if (!live) {
      blockDemoWrite();
      return;
    }
    mutations.setProjectArchived.mutate(
      { id, archived: next },
      {
        onSuccess: () => {
          if (next)
            toastArchived(t, project?.name ?? '', (handlers) =>
              mutations.setProjectArchived.mutate({ id, archived: false }, handlers),
            );
        },
        onError: (error) =>
          toastError(next ? t('无法归档项目。') : t('取消归档失败，请重试。'), error),
      },
    );
  };
  if (missing) {
    return (
      <RouteDialog title={t('项目设置')} size="page">
        <EmptyState
          testId="project-settings-missing"
          icon={FolderSearch}
          title={t('找不到这个项目')}
          description={t('它可能已被删除、改名，或你不在它所属的团队。')}
          className="py-16"
        />
      </RouteDialog>
    );
  }
  const groups: SettingsNavGroup[] = [
    { heading: null, items: SECTIONS.map((s) => ({ id: s.id, label: t(s.label), Icon: s.Icon })) },
  ];
  const hrefFor = (next: string): To => {
    const params = new URLSearchParams(searchParams);
    if (next === 'general') params.delete('tab');
    else params.set('tab', next);
    const search = params.toString();
    return { search: search === '' ? '' : `?${search}` };
  };
  const loading = live && wireProject === undefined;
  const general = (
    <SettingsRows>
      <div className={cn('flex flex-col gap-5', NARROW_ROWS_CLS)}>
        <Section>
          <SettingsRow label={t('名称和图标')}>
            <div className="flex min-w-0 items-center gap-2 max-sm:w-full">
              <ProjectIconPicker
                icon={project?.icon}
                color={project?.color}
                disabled={id === undefined}
                onChange={patch}
                triggerClassName="grid size-8 flex-none place-items-center rounded-(--radius-control) bg-popover text-content-secondary ring-1 ring-border hover:bg-(--menu-hover)"
                trigger={<ProjectAvatar bare name={project?.name} icon={project?.icon} />}
              />
              <Input
                aria-label={t('项目名称')}
                data-testid="project-name-input"
                className={ROW_INPUT_CLS}
                value={nameDraft ?? project?.name ?? ''}
                onChange={(event) => setNameDraft(event.target.value)}
                onBlur={saveName}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    saveName();
                  }
                  if (event.key === 'Escape' && nameDraft !== null) {
                    event.stopPropagation();
                    setNameDraft(null);
                  }
                }}
              />
            </div>
          </SettingsRow>
        </Section>
        <Section title={t('想做什么')}>
          {fieldProject !== undefined && (
            <ProjectInstructionsField
              key={fieldProject.id}
              field="description"
              project={fieldProject}
              teamId={teamId}
              testId="project-goal-input"
            />
          )}
        </Section>
        <Section title={t('模型')}>
          <ProjectModels project={wireProject} live={live} teamId={teamId} />
        </Section>
        {repoKind === undefined && project !== undefined && (
          <Section>
            <SettingsRow label={t('仓库')} valueClassName="text-content-tertiary">
              {t('没有仓库，可让 Coordinator 连接')}
            </SettingsRow>
          </Section>
        )}
        {repoKind !== undefined && (
          <Section title={t('仓库')}>
            <SettingsCard>
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
                      const repo = githubRepoInputToRef((repoDraft ?? '').trim());
                      if (repo === null) {
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
                <SettingsRow label={t('仓库')} valueClassName="font-mono">
                  {project?.repoName ?? ''}
                </SettingsRow>
              )}
              <SettingsRow label={t('目标分支')}>
                {live && wireProject?.repoKind !== undefined ? (
                  <ProjectBaseBranchSelect project={wireProject} />
                ) : (
                  <span
                    className={`prj-set-branch inline-flex w-32 items-center justify-between border px-2.5 font-mono ${SETTINGS_SELECT_TRIGGER_CLS}`}
                  >
                    {project?.defaultBranch ?? 'main'}
                    <ChevronDown width={16} height={16} className="text-content-tertiary" />
                  </span>
                )}
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
            </SettingsCard>
            {live && wireProject?.repoKind === 'local' && (
              <SettingsCard>
                <div className="flex flex-col gap-3 py-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-ui text-foreground">{t('转换为 GitHub 形态')}</span>
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
                        const repo = githubRepoInputToRef(convRepo.trim());
                        if (repo === null) {
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
                      {mutations.patchProject.isPending && <Spinner data-icon="inline-start" />}
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
          </Section>
        )}
        {live && wireProject?.repoKind === 'github' && id !== undefined && teamId !== undefined && (
          <Section title={t('后台自动任务')}>
            <ProjectAutonomyCard projectId={id} teamId={teamId} />
          </Section>
        )}
        <Section>
          <SettingsRow label={archived ? t('取消归档') : t('归档项目')}>
            <Button
              variant="outline"
              data-testid="project-archive"
              disabled={mutations.setProjectArchived.isPending}
              onClick={() => setArchived(!archived)}
            >
              {archived ? (
                <ArchiveRestore data-icon="inline-start" />
              ) : (
                <Archive data-icon="inline-start" />
              )}
              {archived ? t('取消归档') : t('归档')}
            </Button>
          </SettingsRow>
        </Section>
      </div>
    </SettingsRows>
  );
  const body = loading ? (
    projectsQ.isError ? (
      <ProjectsFailed retrying={projectsQ.isFetching} onRetry={() => void projectsQ.refetch()} />
    ) : (
      <div className="flex min-h-28">
        <ProjectsLoading />
      </div>
    )
  ) : section === 'memory' ? (
    <MemoryPanel live={live} teamId={teamId} project={memoryProject ?? null} />
  ) : (
    general
  );
  return (
    <RouteDialog title={t('项目设置')} size="page" bleed>
      <div className="flex h-full min-h-0 max-md:flex-col">
        {navTabs ? (
          <div className="flex-none pt-2">
            <SettingsTabStrip groups={groups} current={section} hrefFor={hrefFor} />
          </div>
        ) : (
          <div className="w-(--settings-nav-w) flex-none border-r border-border">
            <SettingsNav groups={groups} current={section} hrefFor={hrefFor} search={null} />
          </div>
        )}
        <div
          data-testid="project-settings-body"
          className="min-h-0 min-w-0 flex-auto overflow-y-auto px-6 pt-5 max-md:px-4 max-md:pt-3"
        >
          <div
            className={cn(
              'mx-auto w-full max-w-170',
              section === 'memory' && !loading && 'flex min-h-full flex-col',
            )}
          >
            {body}
          </div>
        </div>
      </div>
    </RouteDialog>
  );
}
