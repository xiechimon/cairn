import { cn } from 'cn';
import { FileText } from 'lucide-react';

export interface DiffLine {
  no: string;
  kind: 'add' | 'del' | 'context';
  text: string;
}

export interface DiffFileProps {
  path: string;
  added: number;
  removed: number;
  lines: readonly DiffLine[];
}

const LINE_CLS: Record<DiffLine['kind'], string> = {
  add: 'bg-(--diff-add-bg)',
  del: 'bg-(--diff-del-bg)',
  context: '',
};

export function DiffFile({ path, added, removed, lines }: DiffFileProps) {
  return (
    <figure
      data-slot="diff-file"
      className="m-0 overflow-hidden rounded-xl bg-card font-mono text-meta leading-relaxed shadow-(--e1)"
    >
      <figcaption className="flex items-center gap-2 bg-canvas px-2.5 py-1.5 text-meta">
        <FileText className="size-3 flex-none text-content-tertiary" />
        <span className="min-w-0 truncate">{path}</span>
        <span className="ml-auto flex-none text-running-text">+{added}</span>
        <span className="flex-none text-destructive">−{removed}</span>
      </figcaption>
      {lines.map((line) => (
        <div
          key={`${line.no}${line.kind}${line.text}`}
          className={cn('flex px-2.5 whitespace-pre', LINE_CLS[line.kind])}
        >
          <span className="w-8 flex-none text-content-tertiary">{line.no}</span>
          {line.text}
        </div>
      ))}
    </figure>
  );
}
