import { cn } from 'cn';
import { ChatMarkdown } from './chat-markdown.js';

interface SpecBlockProps {
  spec: string;
  fresh?: boolean;
}

export function SpecBlock({ spec, fresh = false }: SpecBlockProps) {
  return (
    <section
      className={cn(
        'spec-block mt-4 mx-4 rounded-lg border border-(--border) bg-(--secondary) px-4 py-3 text-card-title leading-[1.6] break-words text-(--foreground) [&>*]:max-w-[68ch]',
        fresh && 'mx-auto max-w-180',
      )}
    >
      <ChatMarkdown text={spec} />
    </section>
  );
}
