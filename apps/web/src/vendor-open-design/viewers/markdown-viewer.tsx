// SPDX-License-Identifier: Apache-2.0. Modified by Cairn from nexu-io/open-design@07258801 apps/web/src/components/FileViewer.tsx
import { type ReactNode, type Ref, useMemo } from 'react';
import { ChatMarkdown } from '../../detail/chat-markdown.js';
import { useI18n } from '../../i18n/provider.js';
import { CODE_VIEWER_MAX_LINES, CodeWithLines, codeLines } from './code-with-lines.js';

export type MarkdownViewerMode = 'preview' | 'source';

export function MarkdownViewer({
  text,
  mode,
  articleRef,
  children,
}: {
  text: string;
  mode: MarkdownViewerMode;
  articleRef?: Ref<HTMLElement>;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const lines = useMemo(() => codeLines(text), [text]);
  if (mode === 'source') return <CodeWithLines text={text} lang="markdown" />;
  const shown = lines.slice(0, CODE_VIEWER_MAX_LINES);
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pt-2 pb-4">
      <article
        ref={articleRef}
        data-testid="file-preview-markdown"
        className="relative mx-auto w-full max-w-chat min-w-0 px-3 py-2 text-ui leading-5 text-foreground [overflow-wrap:anywhere]"
      >
        <ChatMarkdown text={shown.join('\n')} />
        {children}
      </article>
      {lines.length > shown.length && (
        <p
          data-testid="file-preview-truncated"
          className="m-0 px-1 pt-2 text-meta text-content-tertiary"
        >
          {t('只显示前 {n} 行，下载查看完整文件', { n: CODE_VIEWER_MAX_LINES })}
        </p>
      )}
    </div>
  );
}
