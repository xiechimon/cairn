// SPDX-License-Identifier: Apache-2.0. Modified by Cairn from nexu-io/open-design@07258801 apps/web/src/components/FileViewer.tsx
import { VideoOff } from 'lucide-react';
import { useState } from 'react';
import { EmptyState } from '../../components/empty-state.js';
import { useI18n } from '../../i18n/provider.js';

export function VideoViewer({
  name,
  src,
  onDownload,
}: {
  name: string;
  src: string;
  onDownload: () => void;
}) {
  const { t } = useI18n();
  const [broken, setBroken] = useState(false);
  if (broken)
    return (
      <EmptyState
        testId="file-preview-broken"
        icon={VideoOff}
        title={t('视频未能加载，请下载查看')}
        action={{ label: t('下载'), onClick: onDownload }}
        className="mt-[10vh]"
      />
    );
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-2">
      <video
        data-testid="file-preview-video"
        src={src}
        title={name}
        controls
        playsInline
        preload="metadata"
        className="max-h-full max-w-full rounded-(--radius-tile)"
        onError={() => setBroken(true)}
      >
        <track kind="captions" />
      </video>
    </div>
  );
}
