import { ImageOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { EmptyState } from '../../../components/empty-state.js';
import { useI18n } from '../../../i18n/provider.js';
import { RegionSurface } from '../file-comments.js';
import type { Zoom } from './zoom.js';

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

function useImageBox(image: HTMLImageElement | null): Box | null {
  const [box, setBox] = useState<Box | null>(null);
  useEffect(() => {
    if (image === null) return;
    const measure = () =>
      setBox({
        left: image.offsetLeft,
        top: image.offsetTop,
        width: image.offsetWidth,
        height: image.offsetHeight,
      });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(image);
    return () => observer.disconnect();
  }, [image]);
  return box;
}

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
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const box = useImageBox(image);
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
      className="relative flex min-h-0 flex-1 overflow-auto overscroll-contain p-2"
    >
      <img
        ref={setImage}
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
      {box !== null && box.width > 0 && (
        <div className="pointer-events-none absolute" style={box}>
          <RegionSurface />
        </div>
      )}
    </div>
  );
}
