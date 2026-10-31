import { Archive } from 'lucide-react';
import { Button } from '../ui/button.js';

export interface ArchivedBannerProps {
  message: string;
  actionLabel: string;
  onAction?: () => void;
}

export function ArchivedBanner({ message, actionLabel, onAction }: ArchivedBannerProps) {
  return (
    <div
      data-slot="archived-banner"
      className="flex items-center gap-3 rounded-(--radius-card) bg-canvas px-4 py-3.5"
    >
      <Archive className="size-4 flex-none text-content-tertiary" />
      <p className="m-0 flex-1 text-ui text-content-secondary">{message}</p>
      <Button size="sm" onClick={onAction} className="h-6.5 px-2.25 text-meta">
        {actionLabel}
      </Button>
    </div>
  );
}
