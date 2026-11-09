import { PackageCheck } from 'lucide-react';
import { usePrs } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { EmptyState } from '../components/empty-state.js';
import { QueryBoundary, type QueryLike } from '../components/query-state.js';
import { SidePanel, SidePanelHead, SidePanelTitle } from '../components/side-panel.js';
import { StoneTrail } from '../components/stone/stone-group.js';
import { prByThread } from '../components/thread/pr-panel-model.js';
import { ThreadRow } from '../components/thread/thread-row.js';
import type { TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { relativeTime } from './rel-time.js';
import { threadCopy, threadStatus } from './thread-copy.js';

export type WorkPane = 'tasks' | 'made' | 'machines';

export const PANE_PARAM = 'pane';

export function paneOf(value: string | null): WorkPane | null {
  return value === 'tasks' || value === 'made' || value === 'machines' ? value : null;
}

interface WorkPanelProps {
  todos: readonly TodoRecord[];
  now: number;
  onClose: () => void;
  onOpenThread: (id: string) => void;
  todosQuery?: QueryLike;
}

export function WorkPanel({ todos, now, onClose, onOpenThread, todosQuery }: WorkPanelProps) {
  const { t } = useI18n();
  const title = t('成果');
  const { live: connected, teamId } = useLiveData();
  const prOf = prByThread(usePrs(teamId, undefined, connected).data);
  const made = todos
    .filter((todo) => threadStatus(todo) === 'done' && todo.archivedAt == null)
    .sort((a, b) => b.phaseAt - a.phaseAt);
  const madeView =
    made.length === 0 ? (
      <EmptyState
        testId="made-empty"
        icon={PackageCheck}
        title={t('还没有完成的工作')}
        description={t('任务合并完成后会出现在这里。')}
        className="mt-[10vh]"
      />
    ) : (
      <StoneTrail className="px-0">
        {made.map((todo) => {
          const pr = prOf.get(todo.id);
          return (
            <ThreadRow
              key={todo.id}
              {...(pr === undefined ? {} : { prLink: { number: pr.number, url: pr.url } })}
              title={todo.title}
              tone="resolved"
              reason={t(threadCopy(todo).reason)}
              age={relativeTime(todo.phaseAt, now, t)}
              onOpen={() => onOpenThread(todo.id)}
            />
          );
        })}
      </StoneTrail>
    );
  return (
    <SidePanel label={title} onDismiss={onClose}>
      <SidePanelHead closeLabel={t('关闭')} onClose={onClose}>
        <SidePanelTitle>{title}</SidePanelTitle>
      </SidePanelHead>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pt-3 pb-4">
        <QueryBoundary
          query={todosQuery}
          isEmpty={made.length === 0}
          loadingLabel={t('正在加载成果')}
          errorTitle={t('成果没能加载')}
          empty={madeView}
        >
          {madeView}
        </QueryBoundary>
      </div>
    </SidePanel>
  );
}
