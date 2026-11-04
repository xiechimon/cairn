import { SeededAvatar } from '@cairn/web';

export const Agents = () => (
  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
    <SeededAvatar name="Implementer" fallback="I" />
    <SeededAvatar name="Reviewer" fallback="R" />
    <SeededAvatar name="Chief" fallback="C" />
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

export const Busy = () => (
  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
    <SeededAvatar name="Implementer" fallback="I" busy />
    <SeededAvatar name="Reviewer" fallback="R" busy />
  </div>
);
