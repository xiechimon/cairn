import { Archive } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { useApiMutations, useProjects } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { relativeTime } from '../board/rel-time.js';
import { EmptyState } from '../components/empty-state.js';
import { QueryBoundary } from '../components/query-state.js';
import {
  SETTINGS_HINT_CLS,
  SETTINGS_ROW_CLS,
  SettingsCard,
  SettingsSection,
} from '../components/settings-list.js';
import { Button } from '../components/ui/button.js';
import { fixtureProjects, useFixtureArchiveEdits } from '../fixtures/project-archive-edits.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { PageShell } from '../pages/shell.js';
import { SETTINGS_HREF } from './settings-href.js';
import { type InFlightIds, startUnarchive } from './unarchive-requests.js';

interface ArchivedProject {
  id: string;
  name: string;
  archivedAt: number;
}

export function ArchivedProjectsSection() {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const fixture = resolveScenario(searchParams);
  const { live, teamId } = useLiveData();
  const projectsQ = useProjects(teamId, live);
  const mutations = useApiMutations(teamId);
  const archiveEdits = useFixtureArchiveEdits();
  const [inFlight, setInFlight] = useState<InFlightIds>(() => new Set());
  const archived: ArchivedProject[] = (
    live
      ? (projectsQ.data ?? []).flatMap((p) =>
          p.archivedAt != null ? [{ id: p.id, name: p.name, archivedAt: p.archivedAt }] : [],
        )
      : fixtureProjects(fixture, archiveEdits).flatMap((p) =>
          p.archivedAt != null ? [{ id: p.id, name: p.name, archivedAt: p.archivedAt }] : [],
        )
  ).toSorted((a, b) => b.archivedAt - a.archivedAt);
  const now = Date.now();
  const unarchive = (id: string) =>
    startUnarchive(id, inFlight, setInFlight, mutations.setProjectArchived, () =>
      toast.error(t('取消归档失败，请重试。')),
    );
  return (
    <PageShell route={`${SETTINGS_HREF}/projects`} title={t('项目')} fixture={fixture}>
      <QueryBoundary
        query={live ? projectsQ : undefined}
        isEmpty={archived.length === 0}
        loadingLabel={t('正在加载项目')}
        errorTitle={t('项目没能加载')}
        empty={
          <EmptyState
            testId="archived-projects-empty"
            icon={Archive}
            title={t('没有已归档的项目')}
            description={t('在侧栏项目菜单里归档的项目会出现在这里。')}
          />
        }
      >
        <SettingsSection title={t('已归档项目')}>
          <SettingsCard>
            {archived.map((project) => (
              <div key={project.id} data-slot="archived-project-row" className={SETTINGS_ROW_CLS}>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-ui text-foreground">{project.name}</span>
                  <span className={SETTINGS_HINT_CLS}>
                    {t('归档于')} {relativeTime(project.archivedAt, now, t)}
                  </span>
                </span>
                <Button
                  variant="outline"
                  data-testid="archived-project-unarchive"
                  disabled={!live || inFlight.has(project.id)}
                  onClick={() => unarchive(project.id)}
                >
                  {inFlight.has(project.id) ? t('取消归档中…') : t('取消归档')}
                </Button>
              </div>
            ))}
          </SettingsCard>
        </SettingsSection>
      </QueryBoundary>
    </PageShell>
  );
}
