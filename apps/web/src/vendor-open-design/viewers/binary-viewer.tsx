// SPDX-License-Identifier: Apache-2.0. Modified by Cairn from nexu-io/open-design@07258801 apps/web/src/components/FileViewer.tsx
import { FileText } from 'lucide-react';
import { EmptyState } from '../../components/empty-state.js';
import { useI18n } from '../../i18n/provider.js';

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function BinaryViewer({
  size,
  onDownload,
}: {
  size: number | undefined;
  onDownload: () => void;
}) {
  const { t } = useI18n();
  return (
    <EmptyState
      testId="file-preview-unsupported"
      icon={FileText}
      title={t('无法预览，下载查看')}
      {...(size !== undefined ? { description: humanSize(size) } : {})}
      action={{ label: t('下载'), onClick: onDownload }}
      className="mt-[10vh]"
    />
  );
}
