import type { ReactNode } from 'react';
import { Button } from '../ui/button.js';

export interface NextStep {
  label: string;
  icon?: ReactNode;
  onClick?: () => void;
}

export function NextSteps({ steps }: { steps: readonly NextStep[] }) {
  return (
    <div data-slot="next-steps" className="flex flex-wrap gap-2">
      {steps.map((step) => (
        <Button
          key={step.label}
          size="sm"
          variant="outline"
          onClick={step.onClick}
          className="h-6.5 px-2.25 text-meta text-content-secondary"
        >
          {step.icon}
          {step.label}
        </Button>
      ))}
    </div>
  );
}
