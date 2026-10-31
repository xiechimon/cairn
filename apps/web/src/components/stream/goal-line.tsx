import type { ReactNode } from 'react';

export function GoalLine({ children }: { children: ReactNode }) {
  return (
    <p
      data-slot="goal-line"
      className="m-0 flex items-baseline gap-2.5 rounded-xl bg-canvas px-3 py-2.5 text-ui text-content-secondary"
    >
      <span className="flex-none text-meta font-medium text-content-tertiary">Goal</span>
      {children}
    </p>
  );
}
