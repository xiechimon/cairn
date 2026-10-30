import { Button, DialogShell } from '@cairn/web';

export const Open = () => (
  <DialogShell
    title="New schedule"
    subtitle="Runs on omarchy for the cairn project"
    onClose={() => {}}
    footer={<><Button variant="ghost">Cancel</Button><Button>Create schedule</Button></>}
  >
    <div style={{ fontSize: 13 }}>Every weekday at 09:00, the Planner reviews open issues and queues up to three tasks.</div>
  </DialogShell>
);
