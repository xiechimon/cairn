// SPDX-License-Identifier: Apache-2.0. Modified by Cairn from nexu-io/open-design@07258801 apps/web/src/components/FileViewer.tsx
import { CodeWithLines } from './code-with-lines.js';
import { ImageViewer } from './image-viewer.js';

export type SvgViewerMode = 'preview' | 'source';

export function SvgViewer({
  name,
  src,
  mode,
  source,
  onDownload,
}: {
  name: string;
  src: string;
  mode: SvgViewerMode;
  source: string;
  onDownload: () => void;
}) {
  if (mode === 'source') return <CodeWithLines text={source} lang="xml" />;
  return <ImageViewer name={name} src={src} onDownload={onDownload} />;
}
