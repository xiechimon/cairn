import type { ReactNode } from 'react';

export function Greeting({ children }: { children: ReactNode }) {
  return (
    <p
      data-slot="greeting"
      className="m-0 max-w-[30ch] font-heading text-xl leading-snug font-medium tracking-tight text-foreground"
    >
      {children}
    </p>
  );
}
