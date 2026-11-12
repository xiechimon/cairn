import { SeededAvatar } from '@cairn/web';

export const Agents = () => (
  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
    <SeededAvatar name="Implementer" fallback="I" />
    <SeededAvatar name="Reviewer" fallback="R" />
    <SeededAvatar name="Coordinator" fallback="C" />
    <SeededAvatar name="Planner" fallback="P" />
  </div>
);

export const Sizes = () => (
  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
    <SeededAvatar name="Implementer" fallback="I" className="size-6" />
    <SeededAvatar name="Implementer" fallback="I" />
    <SeededAvatar name="Implementer" fallback="I" className="size-10" />
  </div>
);
