import { X } from 'lucide-react';
import type { ReactNode, Ref } from 'react';
import { Button } from './ui/button.js';

export function SidePanel({
  ref,
  label,
  onDismiss,
  scrimTestId,
  children,
}: {
  ref?: Ref<HTMLElement>;
  label: string;
  onDismiss: () => void;
  scrimTestId?: string;
  children: ReactNode;
}) {
  return (
    <>
      <div
        data-testid={scrimTestId}
        aria-hidden
        className="side-panel-scrim absolute inset-0 z-(--z-backdrop-low) hidden bg-(--dialog-backdrop) max-[1100px]:block"
        onClick={onDismiss}
      />
      <aside
        ref={ref}
        aria-label={label}
        className="side-panel flex w-105 min-w-0 flex-none flex-col bg-background shadow-[inset_1px_0_0_var(--border)] max-[1100px]:absolute max-[1100px]:inset-y-0 max-[1100px]:right-0 max-[1100px]:z-(--z-panel-low) max-[1100px]:w-[min(420px,100%)] max-[1100px]:shadow-(--floating-shadow) max-[640px]:w-full"
      >
        {children}
      </aside>
    </>
  );
}

export function SidePanelHead({
  closeLabel,
  onClose,
  children,
}: {
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      data-panel-head=""
      className="flex h-13 flex-none items-center gap-1 border-b border-border pr-2.5 pl-4"
    >
      {children}
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-content-tertiary"
        aria-label={closeLabel}
        onClick={onClose}
      >
        <X aria-hidden strokeWidth={1.75} className="size-4" />
      </Button>
    </div>
  );
}

export function SidePanelTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="m-0 flex min-w-0 flex-1 items-center gap-1.5 truncate text-ui font-medium text-foreground">
      {children}
    </h2>
  );
}
