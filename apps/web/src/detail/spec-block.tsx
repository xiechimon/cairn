import { cn } from 'cn';
import { ChatMarkdown } from './chat-markdown.js';

interface SpecBlockProps {
  spec: string;
}

export function SpecBlock({ spec }: SpecBlockProps) {
  return (
    <section
      className={cn(
        'spec-block mt-4 mx-4 rounded-lg border border-(--border) bg-(--secondary) px-4 py-3 text-card-title break-words text-(--foreground) [&>*]:max-w-[68ch]',
      )}
    >
      <ChatMarkdown text={spec} />
    </section>
  );
}
