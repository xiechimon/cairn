import { cn } from 'cn';
import { ExternalLink } from 'lucide-react';

export interface PrLinkProps {
  number: number;
  url: string;
  className?: string;
}

export function PrLink({ number, url, className }: PrLinkProps) {
  return (
    <a
      data-slot="pr-link"
      href={url}
      target="_blank"
      rel="noreferrer"
      className={cn(
        'inline-flex flex-none items-center gap-0.5 rounded-sm font-medium text-content-secondary tabular-nums outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50',
        className,
      )}
    >
      PR #{number}
      <ExternalLink aria-hidden strokeWidth={1.75} className="size-4" />
    </a>
  );
}
