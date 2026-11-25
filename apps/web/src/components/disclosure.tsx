import { cn } from 'cn';
import { type ReactNode, useEffect, useState } from 'react';

const DISCLOSURE_COLLAPSE_MS = 200;

export function Disclosure({
  open,
  children,
  className,
  contentClassName,
  dataAttr,
}: {
  open: boolean;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  dataAttr?: Record<string, string>;
}) {
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  useEffect(() => {
    if (open) return;
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const id = setTimeout(() => setMounted(false), reduced ? 0 : DISCLOSURE_COLLAPSE_MS);
    return () => clearTimeout(id);
  }, [open]);
  return (
    <div
      data-slot="disclosure"
      {...dataAttr}
      inert={!open}
      className={cn(
        'grid transition-[grid-template-rows,opacity] duration-(--dur-overlay) ease-(--ease-out-strong) motion-reduce:transition-none motion-reduce:duration-0',
        open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        className,
      )}
    >
      <div className="min-h-0 overflow-hidden">
        {mounted ? (
          contentClassName !== undefined ? (
            <div className={contentClassName}>{children}</div>
          ) : (
            children
          )
        ) : null}
      </div>
    </div>
  );
}
