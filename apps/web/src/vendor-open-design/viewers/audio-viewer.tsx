// SPDX-License-Identifier: Apache-2.0. Modified by Cairn from nexu-io/open-design@07258801 apps/web/src/components/FileViewer.tsx
import { AudioLines } from 'lucide-react';
import { useState } from 'react';
import { EmptyState } from '../../components/empty-state.js';
import { useI18n } from '../../i18n/provider.js';

export function AudioViewer({
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
        icon={AudioLines}
        title={t('音频未能加载，请下载查看')}
        action={{ label: t('下载'), onClick: onDownload }}
        className="mt-[10vh]"
      />
    );
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-4">
      <AudioLines aria-hidden className="size-5.5 text-icon" />
      <p className="m-0 max-w-full truncate text-ui text-foreground" title={name}>
        {name}
      </p>
      <audio
        data-testid="file-preview-audio"
        src={src}
        title={name}
        controls
        preload="metadata"
        className="w-full max-w-chat"
        onError={() => setBroken(true)}
      >
        <track kind="captions" />
      </audio>
    </div>
  );
}
