import { Input } from '@cairn/web';

export const States = () => (
  <div style={{ width: 300, display: 'flex', flexDirection: 'column', gap: 10 }}>
    <Input placeholder="Task title" />
    <Input defaultValue="Add dark mode toggle to settings" />
    <Input aria-invalid defaultValue="feat/dark mode" />
    <Input disabled defaultValue="xiechimon/cairn" />
  </div>
);

export const Labeled = () => (
  <label style={{ width: 300, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 }}>
    Project name
    <Input defaultValue="cairn-docs" />
  </label>
);
