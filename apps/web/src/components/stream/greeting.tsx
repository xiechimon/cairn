import type { ReactNode } from 'react';

export function Greeting({
  children,
  since,
  wrap = false,
}: {
  children: ReactNode;
  since?: ReactNode;
  wrap?: boolean;
}) {
  return (
    <div data-slot="greeting" className="flex flex-col gap-0.5">
      <h2
        className={`m-0 font-serif text-greeting font-semibold tracking-[-0.01em] text-foreground ${wrap ? 'text-balance' : 'whitespace-nowrap'}`}
      >
        {children}
      </h2>
      {since != null && <p className="m-0 text-meta text-content-tertiary">{since}</p>}
    </div>
  );
}
