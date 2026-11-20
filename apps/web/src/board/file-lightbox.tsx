import { cn } from 'cn';
import { Check, ChevronLeft, ChevronRight, Code, Copy, Download, Eye, X } from 'lucide-react';
import {
  type MouseEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useLocation, useNavigate } from 'react-router';
import { FileGlyph } from '../components/file-glyph.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { QueryBoundary } from '../components/query-state.js';
import { Button } from '../components/ui/button.js';
import { Dialog, DialogContent, DialogTitle } from '../components/ui/dialog.js';
import { toastError } from '../components/ui/toaster.js';
import { useI18n } from '../i18n/provider.js';
import { isEditableTarget } from '../overlay/hotkeys.js';
import { AudioViewer } from '../vendor-open-design/viewers/audio-viewer.js';
import { BinaryViewer } from '../vendor-open-design/viewers/binary-viewer.js';
import { DocumentPreviewViewer } from '../vendor-open-design/viewers/document-preview-viewer.js';
import { ImageViewer } from '../vendor-open-design/viewers/image-viewer.js';
import { MarkdownViewer } from '../vendor-open-design/viewers/markdown-viewer.js';
import { SvgViewer } from '../vendor-open-design/viewers/svg-viewer.js';
import { TextViewer } from '../vendor-open-design/viewers/text-viewer.js';
import { VideoViewer } from '../vendor-open-design/viewers/video-viewer.js';
import { DocumentPreviewUnavailable, useAttachmentFiles } from './file-data.js';
import {
  FILE_NAME_PARAM,
  FILE_PARAM,
  type FileTarget,
  fileTargetOf,
  type OpenFile,
  OpenFileContext,
  withoutFileTarget,
} from './file-pane.js';

const COPIED_MS = 1500;

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

function downloadFile(href: string, name: string): void {
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = name;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

function withFileTarget(search: string, target: FileTarget): string {
  const params = withoutFileTarget(new URLSearchParams(search));
  params.set(FILE_PARAM, target.key);
  params.set(FILE_NAME_PARAM, target.name);
  return `?${params.toString()}`;
}

export function FileLightboxHost({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const target = fileTargetOf(new URLSearchParams(location.search));
  const lightbox = lightboxStateOf(location.state);
  const openFile = useCallback<OpenFile>(
    (next, set = []) => {
      const fileSet = set.some((entry) => entry.key === next.key) ? [...set] : [next];
      navigate(
        { pathname: location.pathname, search: withFileTarget(location.search, next) },
        { state: { fileSet, fileOpened: true } satisfies LightboxState },
      );
    },
    [navigate, location.pathname, location.search],
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
      {
        replace: true,
      },
    );
  }, [lightbox?.fileOpened, navigate, location.pathname, location.search]);
  const show = useCallback(
    (next: FileTarget) =>
      navigate(
        { pathname: location.pathname, search: withFileTarget(location.search, next) },
        { replace: true, state: location.state },
      ),
    [navigate, location.pathname, location.search, location.state],
  );
  return (
    <OpenFileContext.Provider value={openFile}>
      {children}
      <Dialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        {target !== null && (
          <FileLightbox
            target={target}
            set={lightbox?.fileSet ?? [target]}
            onShow={show}
            onClose={close}
          />
        )}
      </Dialog>
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
  const { t } = useI18n();
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
      className="inset-0 top-0 left-0 flex h-dvh w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none bg-(--lightbox-scrim) p-0 text-(--lightbox-ink) ring-0 sm:max-w-none"
    >
      <FileLightboxView key={target.key} target={target} onClose={onClose} />
      {files.length > 1 && (
        <nav
          data-lightbox-keep
          aria-label={t('切换文件')}
          className="flex flex-none items-center justify-center gap-2 pt-2 pb-5"
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
          <span
            data-testid="file-lightbox-position"
            className="min-w-16 text-center text-ui tabular-nums"
          >
            {t('第 {n} 个，共 {total} 个', { n: index + 1, total: files.length })}
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
      )}
    </DialogContent>
  );
}

function FileLightboxView({ target, onClose }: { target: FileTarget; onClose: () => void }) {
  const { t } = useI18n();
  const files = useAttachmentFiles(target.key, { size: true });
  const { kind, src, url, fixture, downloadHref, readsText, readsDocument, size } = files;
  const textQ = files.text;
  const documentQ = files.document;
  const download = () => downloadFile(downloadHref, target.name);
  const [copied, setCopied] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const togglesSource = kind === 'markdown' || kind === 'svg';
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const text = readsText ? textQ.data : undefined;
  const copy = () => {
    if (text === undefined) return;
    navigator.clipboard.writeText(text).then(
      () => setCopied(true),
      (error: unknown) => toastError(t('没能复制，再试一次'), error),
    );
  };
  const withText = (render: (value: string) => ReactNode) => (
    <QueryBoundary
      query={textQ}
      isEmpty={false}
      errorWins
      empty={null}
      loadingLabel={t('正在加载文件')}
      errorTitle={t('文件没能加载')}
      className="px-2"
    >
      {render(text ?? '')}
    </QueryBoundary>
  );
  const binary = <BinaryViewer size={size} onDownload={download} />;
  const media = kind === 'image' || kind === 'video' || (kind === 'svg' && !showSource);
  const body =
    kind === 'markdown' ? (
      withText((value) => <MarkdownViewer text={value} mode={showSource ? 'source' : 'preview'} />)
    ) : kind === 'text' ? (
      withText((value) => <TextViewer name={target.key} text={value} />)
    ) : kind === 'svg' ? (
      showSource ? (
        withText((value) => (
          <SvgViewer
            name={target.name}
            src={src}
            mode="source"
            source={value}
            onDownload={download}
          />
        ))
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
    ) : kind === 'image' ? (
      <ImageViewer key={src} name={target.name} src={src} onDownload={download} />
    ) : kind === 'video' ? (
      <VideoViewer key={src} name={target.name} src={src} onDownload={download} />
    ) : kind === 'audio' ? (
      <AudioViewer key={src} name={target.name} src={src} onDownload={download} />
    ) : kind === 'pdf' && fixture === undefined ? (
      <iframe
        data-testid="file-preview-pdf"
        title={target.name}
        src={url}
        className="min-h-0 flex-1 border-0"
      />
    ) : kind === 'document' && readsDocument ? (
      documentQ.error instanceof DocumentPreviewUnavailable ? (
        binary
      ) : (
        <QueryBoundary
          query={documentQ}
          isEmpty={false}
          errorWins
          empty={null}
          loadingLabel={t('正在加载文件')}
          errorTitle={t('文件没能加载')}
          className="px-2"
        >
          {documentQ.data !== undefined && (
            <DocumentPreviewViewer preview={documentQ.data} size={size} />
          )}
        </QueryBoundary>
      )
    ) : (
      binary
    );
  return (
    <>
      <header className="flex flex-none items-center gap-1 py-3 pr-3 pl-5">
        <DialogTitle className="flex min-w-0 flex-1 items-center gap-2 text-ui font-normal text-(--lightbox-ink)">
          <FileGlyph name={target.name} />
          <span data-testid="file-preview-name" className="truncate" title={target.name}>
            {target.name}
          </span>
        </DialogTitle>
        {togglesSource && (
          <IconTooltip
            label={showSource ? t('查看渲染效果') : t('查看源码')}
            side="bottom"
            trigger={
              <Button
                variant="ghost"
                size="icon-sm"
                data-testid="file-preview-source-toggle"
                disabled={text === undefined}
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
        {readsText && (
          <IconTooltip
            label={copied ? t('已复制') : t('复制')}
            side="bottom"
            trigger={
              <Button
                variant="ghost"
                size="icon-sm"
                data-testid="file-preview-copy"
                disabled={text === undefined}
                onClick={copy}
                className={CONTROL_CLS}
              />
            }
          >
            {copied ? (
              <Check aria-hidden className="size-5.5" />
            ) : (
              <Copy aria-hidden className="size-5.5" />
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
        className={cn('flex min-h-0 flex-1 flex-col px-4 sm:px-16', !media && 'pb-2')}
      >
        {media ? (
          body
        ) : (
          <div
            data-lightbox-keep
            className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col overflow-hidden rounded-(--radius-card) bg-background text-foreground"
          >
            {body}
          </div>
        )}
      </div>
    </>
  );
}
