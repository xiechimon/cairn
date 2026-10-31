import type { ReactNode } from 'react';

export function Greeting({ children, since }: { children: ReactNode; since?: ReactNode }) {
  return (
    <div data-slot="greeting" className="flex flex-col gap-0.5">
      <p className="m-0 font-heading text-xl leading-snug font-medium tracking-tight whitespace-nowrap text-foreground">
        {children}
      </p>
      {since != null && <p className="m-0 text-meta text-content-tertiary">{since}</p>}
    </div>
  );
}
