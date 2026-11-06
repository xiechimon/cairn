import { useState } from 'react';
import { SidebarGroupHeader, SidebarThreadRow } from '../components/shell/sidebar-project.js';
import type { TodoRecord } from '../fixtures/records.js';
import { useMinuteClock } from '../hooks/use-minute-clock.js';
import { useI18n } from '../i18n/provider.js';
import { type ElapsedUnit, elapsedSince, type ThreadGroups } from './sidebar-threads.js';
import { threadStatus } from './thread-copy.js';

const ELAPSED_COPY: Record<ElapsedUnit, string> = {
  m: '{n} 分',
  h: '{n} 小时',
  d: '{n} 天',
};

function ThreadRow({
  todo,
  now,
  open,
  projectName,
  onOpen,
}: {
  todo: TodoRecord;
  now: number;
  open: boolean;
  projectName: string | undefined;
  onOpen: (id: string) => void;
}) {
  const { t } = useI18n();
  const status = threadStatus(todo);
  const elapsed = elapsedSince(todo.phaseAt, now);
  const age = elapsed === null ? null : t(ELAPSED_COPY[elapsed.unit], { n: elapsed.n });
  const snoozed = todo.snoozeMode != null;
  const running = status === 'running' && !snoozed;
  return (
    <SidebarThreadRow
      title={todo.title}
      state={status}
      open={open}
      snoozed={snoozed}
      tag={status === 'failed' && !snoozed ? t('失败') : undefined}
      elapsed={running ? age : null}
      hoverTime={running ? null : age}
      tooltip={projectName === undefined ? todo.title : `${projectName} · ${todo.title}`}
      onClick={() => onOpen(todo.id)}
    />
  );
}

export function SidebarThreadGroups({
  groups,
  openThreadId,
  projectNames,
  onOpen,
}: {
  groups: ThreadGroups;
  openThreadId: string | null;
  projectNames: ReadonlyMap<string, string>;
  onOpen: (id: string) => void;
}) {
  const { t } = useI18n();
  const now = useMinuteClock();
  const [doneOpen, setDoneOpen] = useState(false);
  const rows = (list: TodoRecord[]) =>
    list.map((todo) => (
      <ThreadRow
        key={todo.id}
        todo={todo}
        now={now}
        open={openThreadId === todo.id}
        projectName={projectNames.get(todo.projectId)}
        onOpen={onOpen}
      />
    ));
  return (
    <div data-testid="thread-groups" className="flex flex-col gap-px">
      {groups.needsYou.length > 0 && (
        <section data-testid="thread-group-needs-you" className="flex flex-col gap-px">
          <SidebarGroupHeader label={t('需要你')} count={groups.needsYou.length} accent />
          {rows(groups.needsYou)}
        </section>
      )}
      {groups.running.length > 0 && (
        <section data-testid="thread-group-running" className="mt-1.5 flex flex-col gap-px">
          <SidebarGroupHeader label={t('进行中')} count={groups.running.length} />
          {rows(groups.running)}
        </section>
      )}
      {groups.done.length > 0 && (
        <section data-testid="thread-group-done" className="mt-1.5 flex flex-col gap-px">
          <SidebarGroupHeader
            label={t('已完成')}
            count={groups.done.length}
            expanded={doneOpen}
            onToggle={() => setDoneOpen((prev) => !prev)}
            testId="done-threads-toggle"
          />
          {doneOpen && rows(groups.done)}
        </section>
      )}
    </div>
  );
}
