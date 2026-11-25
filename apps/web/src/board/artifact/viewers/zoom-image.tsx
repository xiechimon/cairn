import { ImageOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { EmptyState } from '../../../components/empty-state.js';
import { useI18n } from '../../../i18n/provider.js';
import { RegionSurface } from '../file-comments.js';
import { MIN_ZOOM, usePinchZoom, type Zoom } from './zoom.js';

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
  onChange,
  onDownload,
}: {
  name: string;
  src: string;
  zoom: Zoom;
  onFitScale: (scale: number) => void;
  onChange: (next: Zoom) => void;
  onDownload: () => void;
}) {
  const { t } = useI18n();
  const [broken, setBroken] = useState(false);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [fitScale, setFitScale] = useState(1);
  const box = useImageBox(image);

  useEffect(() => {
    if (stage === null || natural === null || natural.width <= 0 || natural.height <= 0) return;
    const measure = () => {
      const next = Math.max(
        MIN_ZOOM,
        Math.min(1, stage.clientWidth / natural.width, stage.clientHeight / natural.height),
      );
      setFitScale(next);
      onFitScale(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [stage, natural, onFitScale]);

  const scale = zoom === 'fit' ? fitScale : zoom;
  usePinchZoom({ stage, content: image, scale, onChange });

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
      ref={setStage}
      data-testid="artifact-image-stage"
      className="relative flex min-h-0 flex-1 overflow-auto overscroll-contain p-2"
    >
      <img
        ref={setImage}
        data-testid="file-preview-image"
        src={src}
        alt={name}
        onLoad={(event) => {
          const el = event.currentTarget;
          if (el.naturalWidth > 0 && el.naturalHeight > 0)
            setNatural({ width: el.naturalWidth, height: el.naturalHeight });
        }}
        onError={() => setBroken(true)}
        style={fit ? undefined : { width: natural.width * zoom, maxWidth: 'none' }}
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
