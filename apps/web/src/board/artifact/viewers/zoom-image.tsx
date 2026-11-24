import { ImageOff } from 'lucide-react';
import { useState } from 'react';
import { EmptyState } from '../../../components/empty-state.js';
import { useI18n } from '../../../i18n/provider.js';
import type { Zoom } from './zoom.js';

export function ZoomImage({
  name,
  src,
  zoom,
  onFitScale,
  onDownload,
}: {
  name: string;
  src: string;
  zoom: Zoom;
  onFitScale: (scale: number) => void;
  onDownload: () => void;
}) {
  const { t } = useI18n();
  const [broken, setBroken] = useState(false);
  const [natural, setNatural] = useState<number | null>(null);
  if (broken)
    return (
      <EmptyState
        testId="file-preview-broken"
        icon={ImageOff}
        title={t('图片未能加载，请下载查看')}
        action={{ label: t('下载'), onClick: onDownload }}
        className="mt-[10vh]"
      />
    );
  const fit = zoom === 'fit' || natural === null;
  return (
    <div
      data-testid="artifact-image-stage"
      className="flex min-h-0 flex-1 overflow-auto overscroll-contain p-2"
    >
      <img
        data-testid="file-preview-image"
        src={src}
        alt={name}
        onLoad={(event) => {
          const image = event.currentTarget;
          const stage = image.parentElement;
          setNatural(image.naturalWidth);
          if (stage !== null && image.naturalWidth > 0 && image.naturalHeight > 0)
            onFitScale(
              Math.min(
                1,
                stage.clientWidth / image.naturalWidth,
                stage.clientHeight / image.naturalHeight,
              ),
            );
        }}
        onError={() => setBroken(true)}
        style={fit ? undefined : { width: natural * zoom, maxWidth: 'none' }}
        className={
          fit
            ? 'm-auto max-h-full max-w-full rounded-(--radius-tile) object-contain'
            : 'm-auto flex-none rounded-(--radius-tile)'
        }
      />
    </div>
  );
}
