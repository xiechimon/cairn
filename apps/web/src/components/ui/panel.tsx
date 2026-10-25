import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from 'cn';
import type * as React from 'react';

const panelVariants = cva('rounded-[12px]', {
  variants: {
    variant: {
      quiet: 'bg-secondary',
      outlined: 'border border-border bg-card',
    },
  },
  defaultVariants: {
    variant: 'quiet',
  },
});

function Panel({
  className,
  variant,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof panelVariants>) {
  return <div data-slot="panel" className={cn(panelVariants({ variant }), className)} {...props} />;
}

function PanelHead({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="panel-head"
      className={cn('flex flex-col items-center', className)}
      {...props}
    />
  );
}

function PanelRow({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="panel-row"
      className={cn('flex items-center justify-between border-t border-border', className)}
      {...props}
    />
  );
}

function PanelLabel({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="panel-label"
      className={cn('text-[13px] text-content-secondary', className)}
      {...props}
    />
  );
}

function PanelValue({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="panel-value"
      className={cn('flex items-center text-foreground', className)}
      {...props}
    />
  );
}

export { Panel, PanelHead, PanelLabel, PanelRow, PanelValue };
