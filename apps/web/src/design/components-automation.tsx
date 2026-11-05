import type { ScheduleRecord } from '@cairn/shared';
import { useState } from 'react';
import { ThreadAutomationBadge } from '../board/thread-automations.js';
import { Section, Specimen } from './specimen.js';

const NOW = Date.UTC(2026, 10, 4, 8);
const ACTIVE: ScheduleRecord = {
  id: 'schedule-active', teamId: 'team-1', projectId: 'project-1', todoId: 'todo-1', kind: 'cron',
  cron: '0 9 * * 1-5', prompt: 'Run the login suite and report failures.', enabled: true,
  at: null, tz: 'Asia/Shanghai', nextRunAt: NOW + 3 * 3_600_000,
  lastRunAt: NOW - 21 * 3_600_000, lastRunStatus: 'completed', pausedReason: null, createdBy: 'user-1',
  todo: { seqNum: 9, title: 'Fix the login test', phase: 'building', projectName: 'cairn', ownerId: 'user-1' },
};

function AutomationExample({ initial }: { initial: ScheduleRecord }) {
  const [schedules, setSchedules] = useState([initial]);
  return (
    <ThreadAutomationBadge
      schedules={schedules}
      now={NOW}
      onEnabled={async (id, enabled) => {
        setSchedules((rows) => rows.map((row) => row.id === id ? { ...row, enabled, nextRunAt: enabled ? NOW + 86_400_000 : null, pausedReason: null } : row));
      }}
      onDelete={async (id) => {
        setSchedules((rows) => rows.filter((row) => row.id !== id));
      }}
    />
  );
}

export function AutomationSection() {
  return (
    <Section
      id="thread-automation"
      title="Thread automations"
      lede="The title chip opens the real popover. Pause, resume and delete work on specimen data; finished retained once records have no enable switch."
    >
      <Specimen title="Active automation chip" note="Open to inspect cadence, prompt and the enabled switch">
        <AutomationExample initial={ACTIVE} />
      </Specimen>
      <Specimen title="Paused automation chip" note="The paused icon remains next to the title">
        <AutomationExample initial={{ ...ACTIVE, id: 'schedule-paused', enabled: false, nextRunAt: null }} />
      </Specimen>
      <Specimen title="Finished retained once automation" note="No upcoming run and no switch; deleted server records cannot appear">
        <AutomationExample initial={{ ...ACTIVE, id: 'schedule-once', kind: 'once', at: NOW - 2 * 86_400_000, enabled: false, nextRunAt: null, lastRunAt: NOW - 2 * 86_400_000 }} />
      </Specimen>
      <Specimen title="Automatically disabled automation" note="The reason remains visible when the popover opens">
        <AutomationExample initial={{ ...ACTIVE, id: 'schedule-disabled', enabled: false, nextRunAt: null, pausedReason: 'Host was deleted' }} />
      </Specimen>
    </Section>
  );
}
