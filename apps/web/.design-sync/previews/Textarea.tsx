import { Textarea } from '@cairn/web';

export const Empty = () => (
  <div style={{ width: 420 }}>
    <Textarea placeholder="Describe the task for the implementer…" />
  </div>
);

export const Filled = () => (
  <div style={{ width: 420 }}>
    <Textarea defaultValue={'Add a dark mode toggle to the settings page.\nRun the affected e2e set and open a PR against main.'} />
  </div>
);

export const States = () => (
  <div style={{ width: 420, display: 'flex', flexDirection: 'column', gap: 8 }}>
    <Textarea aria-invalid defaultValue="Too short" />
    <Textarea disabled defaultValue="Task #104 is merged; the brief is read-only." />
  </div>
);
