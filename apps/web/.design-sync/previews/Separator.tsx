import { Separator } from '@cairn/web';

export const Horizontal = () => (
  <div style={{ width: 300, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14 }}>
    <div>Task #104 · Add dark mode toggle</div>
    <Separator />
    <div>Implementer · build #57 · Merged</div>
  </div>
);

export const Vertical = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 20, fontSize: 14 }}>
    <span>cairn</span>
    <Separator orientation="vertical" />
    <span>12 tasks</span>
    <Separator orientation="vertical" />
    <span>3 running</span>
  </div>
);
