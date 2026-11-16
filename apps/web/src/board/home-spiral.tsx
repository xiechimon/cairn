import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { InkSpiral, type SpiralHang } from '../components/ink-spiral.js';
import { useI18n } from '../i18n/provider.js';
import { TASKS_TAB_PARAM } from './work-panel.js';

export const SPIRAL_MAX_PROJECTS = 6;

export type SpiralProject = { id: string; name: string };

export function spiralProjects(
  projects: readonly SpiralProject[],
  waiting: ReadonlySet<string>,
): SpiralProject[] {
  const first = projects.filter((project) => waiting.has(project.id));
  const rest = projects.filter((project) => !waiting.has(project.id));
  return [...first, ...rest].slice(0, SPIRAL_MAX_PROJECTS);
}

export function HomeSpiral({
  projects,
  waiting,
}: {
  projects: readonly SpiralProject[];
  waiting: ReadonlySet<string>;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { search } = useLocation();
  const waitingLabel = t('有任务在等你');
  const newProjectLabel = t('新建项目');
  const plain = useMemo(() => {
    const base = new URLSearchParams(search);
    base.delete('project');
    base.delete('chat');
    base.delete(TASKS_TAB_PARAM);
    return base;
  }, [search]);
  const hangs = useMemo<SpiralHang[]>(
    () =>
      spiralProjects(projects, waiting).map((project) => ({
        key: project.id,
        label: project.name,
        waiting: waiting.has(project.id) ? waitingLabel : null,
        testId: 'home-spiral-project',
        onSelect: () => {
          const next = new URLSearchParams(plain);
          next.set('project', project.id);
          next.set('chat', '1');
          navigate({ pathname: '/app', search: `?${next}` });
        },
      })),
    [projects, waiting, plain, navigate, waitingLabel],
  );
  const tail = useMemo<SpiralHang>(
    () => ({
      key: 'new-project',
      label: newProjectLabel,
      muted: true,
      testId: 'home-spiral-new-project',
      onSelect: () => navigate({ pathname: '/app/project/new', search: `?${plain}` }),
    }),
    [plain, navigate, newProjectLabel],
  );
  return (
    <nav
      aria-label={t('项目')}
      data-testid="home-spiral"
      className="pointer-events-none absolute inset-x-0 top-12 bottom-60 z-10 flex items-center justify-center [&_button]:pointer-events-auto [@media(max-height:700px)]:hidden"
    >
      <InkSpiral hangs={hangs} tail={tail} size={300} />
    </nav>
  );
}
