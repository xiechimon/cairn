import { cn } from 'cn';
import { ChevronLeft, ChevronRight, Code, Download, Eye, Play, X } from 'lucide-react';
import {
  type MouseEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useMemo,
  useState,
} from 'react';
import { useLocation, useNavigate } from 'react-router';
import { FileGlyph } from '../components/file-glyph.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { QueryBoundary } from '../components/query-state.js';
import { Button } from '../components/ui/button.js';
import { Dialog, DialogContent, DialogTitle } from '../components/ui/dialog.js';
import { useI18n } from '../i18n/provider.js';
import { isEditableTarget } from '../overlay/hotkeys.js';
import { ImageViewer } from '../vendor-open-design/viewers/image-viewer.js';
import { SvgViewer } from '../vendor-open-design/viewers/svg-viewer.js';
import { VideoViewer } from '../vendor-open-design/viewers/video-viewer.js';
import { fileMetaLabel, useAttachmentFiles } from './file-data.js';
import {
  FILE_NAME_PARAM,
  FILE_PARAM,
  type FileTarget,
  fileTargetOf,
  OpenDocumentContext,
  type OpenFile,
  OpenFileContext,
  opensInLightbox,
  withoutFileTarget,
} from './file-pane.js';
import { THREAD_PARAM, VIEW_PARAM } from './thread-copy.js';
import { PANE_PARAM, TASKS_TAB_PARAM } from './work-panel.js';

const CONTROL_CLS =
  'text-(--lightbox-ink) hover:bg-(--lightbox-control-hover) hover:text-(--lightbox-ink) dark:hover:bg-(--lightbox-control-hover)';

const KEEP_OPEN = 'img,video,audio,iframe,button,a,[data-lightbox-keep]';

interface LightboxState {
  fileSet: FileTarget[];
  fileOpened: boolean;
}

function lightboxStateOf(state: unknown): LightboxState | null {
  if (state === null || typeof state !== 'object' || !('fileSet' in state)) return null;
  return state as LightboxState;
}

export function downloadFile(href: string, name: string): void {
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = name;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

function withFileTarget(params: URLSearchParams, target: FileTarget): string {
  const next = withoutFileTarget(params);
  next.set(FILE_PARAM, target.key);
  next.set(FILE_NAME_PARAM, target.name);
  return `?${next.toString()}`;
}

function withoutPanels(search: string): URLSearchParams {
  const params = new URLSearchParams(search);
  for (const key of [THREAD_PARAM, VIEW_PARAM, PANE_PARAM, TASKS_TAB_PARAM]) params.delete(key);
  return params;
}

export function FileViewerHost({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const target = fileTargetOf(new URLSearchParams(location.search));
  const lightbox = lightboxStateOf(location.state);
  const media = target !== null && opensInLightbox(target);
  const openFile = useCallback<OpenFile>(
    (next, set = []) => {
      const { pathname, search, state } = location;
      if (opensInLightbox(next)) {
        const shown = set.filter(opensInLightbox);
        const fileSet = shown.some((entry) => entry.key === next.key) ? shown : [next];
        navigate(
          { pathname, search: withFileTarget(new URLSearchParams(search), next) },
          { state: { fileSet, fileOpened: true } satisfies LightboxState },
        );
        return;
      }
      const current = fileTargetOf(new URLSearchParams(search));
      const swap = current !== null && !opensInLightbox(current);
      navigate(
        { pathname, search: withFileTarget(withoutPanels(search), next) },
        swap
          ? { replace: true, state }
          : { state: { fileSet: [next], fileOpened: true } satisfies LightboxState },
      );
    },
    [navigate, location],
  );
  const close = useCallback(() => {
    if (lightbox?.fileOpened === true) {
      navigate(-1);
      return;
    }
    const params = withoutFileTarget(new URLSearchParams(location.search));
    const search = params.toString();
    navigate(
      { pathname: location.pathname, search: search === '' ? '' : `?${search}` },
      { replace: true },
    );
  }, [lightbox?.fileOpened, navigate, location.pathname, location.search]);
  const show = useCallback(
    (next: FileTarget) =>
      navigate(
        {
          pathname: location.pathname,
          search: withFileTarget(new URLSearchParams(location.search), next),
        },
        { replace: true, state: location.state },
      ),
    [navigate, location.pathname, location.search, location.state],
  );
  const document = useMemo(
    () => (target === null || media ? null : { target, close }),
    [target?.key, target?.name, media, close],
  );
  return (
    <OpenFileContext.Provider value={openFile}>
      <OpenDocumentContext.Provider value={document}>
        {children}
        <Dialog
          open={media}
          onOpenChange={(open) => {
            if (!open) close();
          }}
        >
          {target !== null && media && (
            <FileLightbox
              target={target}
              set={lightbox?.fileSet ?? [target]}
              onShow={show}
              onClose={close}
            />
          )}
        </Dialog>
      </OpenDocumentContext.Provider>
    </OpenFileContext.Provider>
  );
}

function FileLightbox({
  target,
  set,
  onShow,
  onClose,
}: {
  target: FileTarget;
  set: readonly FileTarget[];
  onShow: (target: FileTarget) => void;
  onClose: () => void;
}) {
  const files = useMemo(
    () => (set.some((entry) => entry.key === target.key) ? set : [target]),
    [set, target],
  );
  const index = files.findIndex((entry) => entry.key === target.key);
  const previous = index > 0 ? files[index - 1] : undefined;
  const next = index < files.length - 1 ? files[index + 1] : undefined;
  const stepOnArrow = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    if (isEditableTarget(event.target) || event.target instanceof HTMLMediaElement) return;
    const step = event.key === 'ArrowLeft' ? previous : next;
    if (step === undefined) return;
    event.preventDefault();
    onShow(step);
  };
  const dismissOutside = (event: MouseEvent<HTMLElement>) => {
    if (event.target instanceof Element && event.target.closest(KEEP_OPEN) === null) onClose();
  };
  return (
    <DialogContent
      showCloseButton={false}
      data-testid="file-lightbox"
      onClick={dismissOutside}
      onKeyDown={stepOnArrow}
      className="inset-0 top-0 left-0 flex h-dvh w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-clip rounded-none bg-(--lightbox-scrim) p-0 text-(--lightbox-ink) ring-0 sm:max-w-none"
    >
      <FileLightboxView key={target.key} target={target} onClose={onClose} />
      {previous !== undefined && (
        <LightboxPeek side="previous" file={previous} onShow={() => onShow(previous)} />
      )}
      {next !== undefined && <LightboxPeek side="next" file={next} onShow={() => onShow(next)} />}
      {files.length > 1 && (
        <LightboxFilmstrip
          files={files}
          index={index}
          previous={previous}
          next={next}
          onShow={onShow}
        />
      )}
    </DialogContent>
  );
}

function MediaThumb({ file, className }: { file: FileTarget; className?: string }) {
  const { kind, src } = useAttachmentFiles(file.key, { tile: true });
  return kind === 'video' ? (
    <video
      aria-hidden
      src={`${src}#t=0.1`}
      muted
      playsInline
      preload="metadata"
      className={cn('pointer-events-none size-full object-cover', className)}
    />
  ) : (
    <img
      alt=""
      src={src}
      draggable={false}
      className={cn('pointer-events-none size-full object-cover', className)}
    />
  );
}

function LightboxPeek({
  side,
  file,
  onShow,
}: {
  side: 'previous' | 'next';
  file: FileTarget;
  onShow: () => void;
}) {
  const { t } = useI18n();
  const label =
    side === 'previous'
      ? t('上一个：{name}', { name: file.name })
      : t('下一个：{name}', { name: file.name });
  return (
    <Button
      variant="ghost"
      data-testid={`file-lightbox-peek-${side}`}
      aria-label={label}
      title={label}
      onClick={onShow}
      className={cn(
        'absolute top-1/2 z-1 h-100 max-h-[60dvh] w-21 -translate-y-1/2 cursor-pointer overflow-hidden rounded-(--radius-card) border-0 bg-(--lightbox-control) p-0 opacity-50 transition-opacity duration-(--dur-fast) hover:bg-(--lightbox-control) hover:opacity-85 focus-visible:opacity-85 focus-visible:outline-2 focus-visible:outline-(--lightbox-ink) dark:hover:bg-(--lightbox-control) max-sm:hidden',
        'hover:shadow-(--e2)',
        side === 'previous' ? '-left-11' : '-right-11',
      )}
    >
      <MediaThumb file={file} />
    </Button>
  );
}

function LightboxFilmstrip({
  files,
  index,
  previous,
  next,
  onShow,
}: {
  files: readonly FileTarget[];
  index: number;
  previous: FileTarget | undefined;
  next: FileTarget | undefined;
  onShow: (target: FileTarget) => void;
}) {
  const { t } = useI18n();
  return (
    <nav
      data-lightbox-keep
      data-testid="file-lightbox-filmstrip"
      aria-label={t('切换文件')}
      className="mx-auto mb-4 flex flex-none items-center gap-1.5 rounded-(--radius-composer) bg-(--lightbox-tray) px-2 py-1.5 shadow-(--e2)"
    >
      <IconTooltip
        label={t('上一个')}
        side="top"
        trigger={
          <Button
            variant="ghost"
            size="icon-sm"
            data-testid="file-lightbox-prev"
            disabled={previous === undefined}
            focusableWhenDisabled
            onClick={() => previous !== undefined && onShow(previous)}
            className={CONTROL_CLS}
          />
        }
      >
        <ChevronLeft aria-hidden className="size-5" />
      </IconTooltip>
      {files.map((file, at) => (
        <Button
          key={file.key}
          variant="ghost"
          data-testid="file-lightbox-thumb"
          aria-label={file.name}
          aria-current={at === index ? 'true' : undefined}
          title={file.name}
          onClick={() => onShow(file)}
          className={cn(
            'relative h-9 w-13 flex-none cursor-pointer overflow-hidden rounded-(--radius-control) border-0 bg-(--lightbox-control) p-0 transition-opacity duration-(--dur-fast) hover:bg-(--lightbox-control) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--lightbox-ink) dark:hover:bg-(--lightbox-control)',
            at === index
              ? 'opacity-100 ring-2 ring-(--lightbox-ink)'
              : 'opacity-60 hover:opacity-100',
          )}
        >
          <MediaThumb file={file} />
          {opensAsVideo(file) && (
            <Play
              aria-hidden
              className="absolute inset-0 m-auto size-4 fill-(--lightbox-ink) text-(--lightbox-ink)"
            />
          )}
        </Button>
      ))}
      <span
        data-testid="file-lightbox-position"
        className="min-w-12 text-center text-meta text-(--lightbox-ink) tabular-nums"
      >
        {`${index + 1} / ${files.length}`}
      </span>
      <IconTooltip
        label={t('下一个')}
        side="top"
        trigger={
          <Button
            variant="ghost"
            size="icon-sm"
            data-testid="file-lightbox-next"
            disabled={next === undefined}
            focusableWhenDisabled
            onClick={() => next !== undefined && onShow(next)}
            className={CONTROL_CLS}
          />
        }
      >
        <ChevronRight aria-hidden className="size-5" />
      </IconTooltip>
    </nav>
  );
}

function opensAsVideo(file: FileTarget): boolean {
  return /\.(mp4|mov|webm)$/i.test(file.key);
}

function FileLightboxView({ target, onClose }: { target: FileTarget; onClose: () => void }) {
  const { t } = useI18n();
  const files = useAttachmentFiles(target.key, { size: true });
  const { kind, src, downloadHref, size } = files;
  const textQ = files.text;
  const download = () => downloadFile(downloadHref, target.name);
  const [showSource, setShowSource] = useState(false);
  const body =
    kind === 'svg' ? (
      showSource ? (
        <div
          data-lightbox-keep
          className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col overflow-hidden rounded-(--radius-card) bg-background text-foreground"
        >
          <QueryBoundary
            query={textQ}
            isEmpty={false}
            errorWins
            empty={null}
            loadingLabel={t('正在加载文件')}
            errorTitle={t('文件未能加载')}
            className="px-2"
          >
            <SvgViewer
              name={target.name}
              src={src}
              mode="source"
              source={textQ.data ?? ''}
              onDownload={download}
            />
          </QueryBoundary>
        </div>
      ) : (
        <SvgViewer
          key={src}
          name={target.name}
          src={src}
          mode="preview"
          source=""
          onDownload={download}
        />
      )
    ) : kind === 'video' ? (
      <VideoViewer key={src} name={target.name} src={src} onDownload={download} />
    ) : (
      <ImageViewer key={src} name={target.name} src={src} onDownload={download} />
    );
  return (
    <>
      <header
        data-testid="file-lightbox-head"
        className="file-lightbox-head flex h-13 flex-none items-center gap-2 pr-3 pl-5"
      >
        <DialogTitle className="flex min-w-0 flex-1 items-center gap-2 text-ui font-normal text-(--lightbox-ink)">
          <FileGlyph name={target.key} />
          <span data-testid="file-preview-name" className="min-w-0 truncate" title={target.name}>
            {target.name}
          </span>
          <span
            data-testid="file-preview-meta"
            className="flex-none text-meta text-(--lightbox-ink-dim) tabular-nums"
          >
            {fileMetaLabel(target.key, size)}
          </span>
        </DialogTitle>
        {kind === 'svg' && (
          <IconTooltip
            label={showSource ? t('查看渲染效果') : t('查看源码')}
            side="bottom"
            trigger={
              <Button
                variant="ghost"
                size="icon-sm"
                data-testid="file-preview-source-toggle"
                onClick={() => setShowSource((current) => !current)}
                className={CONTROL_CLS}
              />
            }
          >
            {showSource ? (
              <Eye aria-hidden className="size-5.5" />
            ) : (
              <Code aria-hidden className="size-5.5" />
            )}
          </IconTooltip>
        )}
        <IconTooltip
          label={t('下载')}
          side="bottom"
          trigger={
            <Button
              variant="ghost"
              size="icon-sm"
              data-testid="file-preview-download"
              nativeButton={false}
              render={<a href={downloadHref} download={target.name} />}
              className={CONTROL_CLS}
            />
          }
        >
          <Download aria-hidden className="size-5.5" />
        </IconTooltip>
        <span aria-hidden className="mx-1.5 h-5 w-px bg-(--lightbox-rule)" />
        <IconTooltip
          label={t('关闭')}
          side="bottom"
          trigger={
            <Button
              variant="ghost"
              size="icon-sm"
              data-testid="file-lightbox-close"
              onClick={onClose}
              className={CONTROL_CLS}
            />
          }
        >
          <X aria-hidden className="size-5.5" />
        </IconTooltip>
      </header>
      <div
        data-testid="file-preview-body"
        className="flex min-h-0 flex-1 flex-col px-4 pb-4 sm:px-28"
      >
        {body}
      </div>
    </>
  );
}
