import { Link, useLocation } from 'react-router';
import type { HomeOverview, ProjectGlance } from '../board/board.js';
import { withColumnParam } from '../board/columns.js';
import { ProjectAvatar } from '../board/project-avatar.js';
import { useI18n } from '../i18n/provider.js';

function ProjectLine({ row }: { row: ProjectGlance }) {
  const { t } = useI18n();
  const parts = [
    row.running > 0 ? t('{n} 个在跑', { n: row.running }) : null,
    row.doneToday > 0 ? t('今天合并 {n} 个', { n: row.doneToday }) : null,
    row.needsYou > 0 ? t('{n} 项待你处理', { n: row.needsYou }) : null,
  ].filter((part) => part != null);
  return (
    <li data-testid="chief-home-project" className="flex min-w-0 items-center gap-2">
      <ProjectAvatar name={row.name} tone={row.tone} />
      <b className="min-w-24 truncate font-medium text-foreground">{row.name}</b>
      <span className="truncate">{parts.join(t('，'))}</span>
    </li>
  );
}

export function HomeSummary({
  needsYou,
  running,
  doneToday,
  byProject,
}: Omit<HomeOverview, 'sections'>) {
  const { t } = useI18n();
  const { search } = useLocation();
  return (
    <>
      {t('{running} 个任务运行中，今天合并了 {done} 个', { running, done: doneToday })}
      {needsYou > 0 ? (
        <>
          {t('，')}
          <Link
            data-testid="chief-home-needs-you"
            to={{ search: withColumnParam(search, 'pending') }}
            className="font-medium text-foreground underline underline-offset-4"
          >
            {t('{n} 项待你处理', { n: needsYou })}
          </Link>
        </>
      ) : (
        t('，没有需要你的事')
      )}
      {byProject.length > 0 && (
        <ul
          data-testid="chief-home-projects"
          aria-label={t('各项目')}
          className="m-0 mt-2 grid list-none gap-1.5 p-0"
        >
          {byProject.map((row) => (
            <ProjectLine key={row.projectId} row={row} />
          ))}
        </ul>
      )}
    </>
  );
}
