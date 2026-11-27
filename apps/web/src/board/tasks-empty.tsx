import type { ReactNode } from 'react';

export function TasksEmpty({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action: ReactNode;
}) {
  return (
    <div
      data-testid="tasks-empty"
      className="mt-16 flex flex-col items-center gap-3 px-6 text-center"
    >
      <p className="m-0 text-ui text-content-secondary">{title}</p>
      {hint !== undefined && (
        <p className="m-0 max-w-80 text-meta text-balance text-content-secondary">{hint}</p>
      )}
      {action}
    </div>
  );
}
