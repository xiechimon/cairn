import { FolderSearch, TriangleAlert } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { EmptyState } from '../components/empty-state.js';
import { ListCard, ListRow } from '../components/list-card.js';
import { Button } from '../components/ui/button.js';
import { useI18n } from '../i18n/provider.js';
import { ProjectAvatar } from './project-avatar.js';
import type { ProjectSuggestions, SuggestableProject } from './project-suggestions.js';

const COORDINATOR_HREF = '/app';

export function ProjectsLoading() {
  const { t } = useI18n();
  return (
    <section
      data-testid="project-loading"
      aria-busy="true"
      aria-label={t('正在加载项目')}
      className="flex min-h-0 min-w-0 flex-1"
    />
  );
}

export function ProjectNotFound({
  unknownId,
  suggestions,
  projectHref,
}: {
  unknownId: string;
  suggestions: ProjectSuggestions<SuggestableProject>;
  projectHref: (projectId: string) => string;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  return (
    <section
      data-testid="project-not-found"
      aria-label={t('找不到这个项目')}
      className="flex min-h-0 min-w-0 flex-1 flex-col items-center gap-6 overflow-y-auto px-6 py-16 max-[640px]:px-4"
    >
      <div className="flex flex-col items-center gap-3">
        <EmptyState
          icon={FolderSearch}
          title={t('找不到这个项目')}
          description={t('它可能已被删除、改名，或你不在它所属的团队。')}
          action={{ label: t('打开 Coordinator'), onClick: () => navigate(COORDINATOR_HREF) }}
          className="p-0"
        />
        <code
          data-testid="project-not-found-id"
          className="max-w-full truncate rounded-md bg-sidebar-hover px-2 py-1 text-meta text-content-secondary"
        >
          {unknownId}
        </code>
      </div>
      {suggestions.projects.length > 0 && (
        <nav
          aria-label={suggestions.kind === 'close' ? t('你是不是想找') : t('最近的项目')}
          className="flex w-full max-w-80 flex-col gap-2"
        >
          <span className="text-caption text-content-tertiary">
            {suggestions.kind === 'close' ? t('你是不是想找') : t('最近的项目')}
          </span>
          <ListCard>
            {suggestions.projects.map((project, index) => (
              <Link
                key={project.id}
                to={projectHref(project.id)}
                data-testid="project-suggestion"
                className="block focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
              >
                <ListRow
                  icon={
                    <span aria-hidden="true" className="flex">
                      <ProjectAvatar
                        name={project.name}
                        tone={index}
                        icon={project.icon}
                        color={project.color}
                        bare
                      />
                    </span>
                  }
                  title={project.name}
                />
              </Link>
            ))}
          </ListCard>
        </nav>
      )}
    </section>
  );
}

export function ProjectsFailed({
  onRetry,
  retrying = false,
}: {
  onRetry: () => void;
  retrying?: boolean;
}) {
  const { t } = useI18n();
  return (
    <section
      data-testid="project-load-error"
      aria-label={t('项目没能加载')}
      className="flex min-h-0 min-w-0 flex-1 flex-col items-center gap-4 overflow-y-auto px-6 py-16 max-[640px]:px-4"
    >
      <EmptyState
        icon={TriangleAlert}
        title={t('项目没能加载')}
        description={t('检查网络后再试一次。')}
        action={{ label: t('重试'), onClick: onRetry, disabled: retrying }}
        className="p-0"
      />
      <Button variant="ghost" size="sm" render={<Link to={COORDINATOR_HREF} />}>
        {t('打开 Coordinator')}
      </Button>
    </section>
  );
}
