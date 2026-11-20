import { Check } from 'lucide-react';
import { Button } from '../../components/ui/button.js';
import { RingSpinner } from '../../components/ui/ring-spinner.js';

export interface PlanApprovalProps {
  approved: boolean;
  approvedText?: string;
  onApprove?: () => void;
  onEdit?: () => void;
}

export function PlanApproval({ approved, approvedText, onApprove, onEdit }: PlanApprovalProps) {
  if (approved) {
    return (
      <p
        data-slot="plan-approval"
        data-approved=""
        className="m-0 flex items-center gap-2 text-ui text-content-tertiary"
      >
        <RingSpinner className="size-5" />
        {approvedText}
      </p>
    );
  }
  return (
    <div data-slot="plan-approval" className="flex flex-wrap gap-2">
      <Button size="sm" onClick={onApprove} className="h-6.5 px-2.25 text-meta">
        <Check className="size-4" />
        Approve plan
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={onEdit}
        className="h-6.5 px-2.25 text-meta text-content-secondary"
      >
        Edit plan
      </Button>
    </div>
  );
}
