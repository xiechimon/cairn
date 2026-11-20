// SPDX-License-Identifier: Apache-2.0. Modified by Cairn from nexu-io/open-design@07258801 apps/web/src/components/FileViewer.tsx
import { Fragment } from 'react';
import { Separator } from '../../components/ui/separator.js';
import { useI18n } from '../../i18n/provider.js';
import { humanSize } from './binary-viewer.js';

export type DocumentPreviewKind = 'document' | 'presentation' | 'spreadsheet';

export interface DocumentPreview {
  kind: DocumentPreviewKind;
  title: string;
  sections: { title: string; lines: string[] }[];
}

const KIND_LABEL: Record<DocumentPreviewKind, string> = {
  document: '文稿',
  presentation: '演示文稿',
  spreadsheet: '表格',
};

export function DocumentPreviewViewer({
  preview,
  size,
}: {
  preview: DocumentPreview;
  size: number | undefined;
}) {
  const { t } = useI18n();
  const meta = t(KIND_LABEL[preview.kind]);
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pt-2 pb-4">
      <article
        data-testid="file-preview-document"
        className="mx-auto flex w-full max-w-chat min-w-0 flex-col gap-4 px-3 py-2 text-foreground [overflow-wrap:anywhere]"
      >
        <header className="flex flex-col gap-1">
          <p className="m-0 text-meta text-content-tertiary tabular-nums">
            {size === undefined ? meta : `${meta} · ${humanSize(size)}`}
          </p>
          <h2 className="m-0 font-heading text-heading font-title">{preview.title}</h2>
        </header>
        {preview.sections.map((section, index) => (
          <Fragment key={`${section.title}-${index}`}>
            <Separator />
            <section className="flex flex-col gap-2">
              <h3 className="m-0 text-meta font-medium text-content-secondary">{section.title}</h3>
              {section.lines.map((line, lineIndex) => (
                <p key={lineIndex} className="m-0 text-ui leading-6 whitespace-pre-wrap">
                  {line}
                </p>
              ))}
            </section>
          </Fragment>
        ))}
      </article>
    </div>
  );
}
