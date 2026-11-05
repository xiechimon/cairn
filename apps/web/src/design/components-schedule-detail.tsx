import type { ScheduleRecord } from '@cairn/shared';
import { useState } from 'react';
import { Button } from '../components/ui/button.js';
import { ScheduleDetailDialog } from '../schedules/schedule-detail-dialog.js';
import { ScheduleFields } from '../schedules/schedule-fields.js';
import { scheduleDraft } from '../schedules/schedule-model.js';
import { ProductProviders } from './product-providers.js';
import { Section, Specimen } from './specimen.js';

const NOW = Date.UTC(2026, 10, 4, 12);
const SCHEDULE: ScheduleRecord = {
  id: 'gallery-schedule', teamId: 'gallery-team', projectId: 'gallery-project', todoId: 'gallery-todo',
  kind: 'daily', cron: '0 9 * * *', at: Date.UTC(2026, 10, 4, 1), tz: 'Asia/Shanghai', prompt: 'Run the release checks. Report failures with their traces.',
  enabled: true, nextRunAt: NOW + 86_400_000, lastRunAt: NOW - 86_400_000, lastRunStatus: 'completed', pausedReason: null, createdBy: 'gallery-user',
  todo: { seqNum: 412, title: 'Nightly release checks', phase: 'done', projectName: 'cairn', ownerId: 'gallery-user' },
};

function ScheduleDetailExamples() {
  const [draft, setDraft] = useState(() => scheduleDraft(SCHEDULE, NOW));
  const [selected, setSelected] = useState<ScheduleRecord | null>(null);
  const [reject, setReject] = useState(false);
  const save = async () => { if (reject) throw new Error('The schedule could not be saved. Your draft is still here.'); setSelected(null); };
  return <>
    <Specimen title="Trigger editor" note="The app's real fields, including timezone, on-the-hour note, weekdays and custom cron">
      <div className="w-full max-w-110"><ScheduleFields value={draft} onChange={setDraft} tz={SCHEDULE.tz} /></div>
    </Specimen>
    <Specimen title="Detail dialog states" note="Real DialogShell and actions with local data; these examples do not establish API acceptance.">
      <Button variant="outline" onClick={() => setSelected(SCHEDULE)}>Active</Button>
      <Button variant="outline" onClick={() => setSelected({ ...SCHEDULE, enabled: false, nextRunAt: null })}>Paused</Button>
      <Button variant="outline" onClick={() => setSelected({ ...SCHEDULE, enabled: false, nextRunAt: null, pausedReason: 'The host machine was removed.' })}>Auto-disabled</Button>
      <Button variant="outline" onClick={() => setSelected({ ...SCHEDULE, kind: 'once', nextRunAt: null })}>Finished once</Button>
      <Button variant="outline" aria-pressed={reject} onClick={() => setReject((previous) => !previous)}>Reject Save: {reject ? 'on' : 'off'}</Button>
    </Specimen>
    {selected !== null && <ScheduleDetailDialog
      key={selected.id}
      schedule={selected}
      now={NOW}
      onClose={() => setSelected(null)}
      onSave={save}
      onEnabled={async (enabled) => setSelected({ ...selected, enabled, pausedReason: null, nextRunAt: enabled ? NOW + 86_400_000 : null })}
      onRun={async () => setSelected({ ...selected, nextRunAt: NOW })}
      onDelete={async () => setSelected(null)}
    />}
  </>;
}

export function ScheduleDetailSection() {
  return <Section id="schedule-detail" title="Scheduled task detail" lede="Owner-picked dialog B: saved prompt, cadence, next and last run, immediate pause/resume and Run now, with an explicit replacement save.">
    <ProductProviders><ScheduleDetailExamples /></ProductProviders>
  </Section>;
}
