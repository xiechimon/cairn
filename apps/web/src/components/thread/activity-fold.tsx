import { cn } from 'cn';
import { ChevronRight } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible.js';

export interface ActivityLine {
  text: string;
  ok?: boolean;
}

export interface ActivityFoldProps {
  summary: string;
  lines?: readonly ActivityLine[];
  defaultOpen?: boolean;
}

export function ActivityFold({ summary, lines = [], defaultOpen = false }: ActivityFoldProps) {
  const expandable = lines.length > 0;
  return (
    <Collapsible defaultOpen={defaultOpen} disabled={!expandable} data-slot="activity-fold">
      <CollapsibleTrigger className="group/fold flex cursor-pointer items-center gap-1.5 text-ui text-content-tertiary outline-none hover:text-content-secondary focus-visible:text-foreground disabled:cursor-default">
        <ChevronRight className="size-3 transition-transform duration-(--dur-fast) group-data-panel-open/fold:rotate-90" />
        {summary}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="mt-1.5 mb-0 ml-5 flex list-none flex-col gap-0.75 border-l border-border py-0 pl-3 font-mono text-meta text-content-secondary">
          {lines.map((line) => (
            <li key={line.text} className={cn(line.ok === true && 'text-running-text')}>
              {line.text}
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
