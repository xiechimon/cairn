import type { ArtifactRect } from '@cairn/shared';
import { ChevronLeft, ChevronRight, FileWarning, Play } from 'lucide-react';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { EmptyState } from '../../../components/empty-state.js';
import { IconTooltip } from '../../../components/icon-tooltip.js';
import { Button } from '../../../components/ui/button.js';
import { Skeleton } from '../../../components/ui/skeleton.js';
import { useI18n } from '../../../i18n/provider.js';
import { RegionSurface, useCommentLayer } from '../file-comments.js';
import { useFileBytes } from './use-file-bytes.js';
import { MIN_ZOOM, usePinchZoom, type Zoom } from './zoom.js';

type PdfJs = typeof import('pdfjs-dist');

const CSS_UNITS = 96 / 72;
const PAGE_GAP = 16;
const MAX_PAGES = 300;
const DECK_KEYS: Record<string, number> = {
  ArrowRight: 1,
  ArrowDown: 1,
  PageDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
  PageUp: -1,
};

let pdfjsModule: Promise<PdfJs> | null = null;

function loadPdfJs(): Promise<PdfJs> {
  pdfjsModule ??= Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]).then(
    ([lib, worker]) => {
      lib.GlobalWorkerOptions.workerSrc = worker.default;
      return lib;
    },
    (error: unknown) => {
      pdfjsModule = null;
      throw error;
    },
  );
  return pdfjsModule;
}

interface PageSize {
  width: number;
  height: number;
}

interface Opened {
  pdfjs: PdfJs;
  doc: PDFDocumentProxy;
  sizes: PageSize[];
}

function useOpenedPdf(bytes: ArrayBuffer | undefined) {
  const [state, setState] = useState<{ opened: Opened | null; failed: boolean }>({
    opened: null,
    failed: false,
  });
  useEffect(() => {
    if (bytes === undefined) return;
    let live = true;
    let loading: ReturnType<PdfJs['getDocument']> | null = null;
    setState({ opened: null, failed: false });
    void (async () => {
      try {
        const pdfjs = await loadPdfJs();
        if (!live) return;
        loading = pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) });
        const doc = await loading.promise;
        const count = Math.min(doc.numPages, MAX_PAGES);
        const pages = await Promise.all(
          Array.from({ length: count }, (_, index) => doc.getPage(index + 1)),
        );
        const sizes = pages.map((page) => {
          const viewport = page.getViewport({ scale: 1 });
          return { width: viewport.width, height: viewport.height };
        });
        if (live) setState({ opened: { pdfjs, doc, sizes }, failed: false });
      } catch {
        if (live) setState({ opened: null, failed: true });
      }
    })();
    return () => {
      live = false;
      void loading?.destroy();
    };
  }, [bytes]);
  return state;
}

export function PdfCover({
  src,
  width,
  onPages,
}: {
  src: string;
  width: number;
  onPages: (pages: number) => void;
}) {
  const bytes = useFileBytes(src).data;
  const { opened } = useOpenedPdf(bytes);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (opened !== null) onPages(opened.doc.numPages);
  }, [opened, onPages]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (opened === null || canvas === null) return;
    let task: ReturnType<PDFPageProxy['render']> | null = null;
    let live = true;
    void opened.doc.getPage(1).then((page) => {
      if (!live) return;
      const base = page.getViewport({ scale: 1 });
      const ratio = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: (width / base.width) * ratio });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      task = page.render({ canvas, viewport });
      task.promise.catch(() => undefined);
    });
    return () => {
      live = false;
      task?.cancel();
    };
  }, [opened, width]);
  return (
    <canvas
      ref={canvasRef}
      data-testid="chat-artifact-cover"
      aria-hidden
      className="block h-auto w-full bg-(--page-preview)"
    />
  );
}

interface PdfWord {
  page: number;
  rect: ArtifactRect;
  text: string;
}

const MATCH_CHARS = 40;

function plainCjk(text: string): string {
  return text.replace(/[\u2E80-\u2FDF]/g, (glyph) => glyph.normalize('NFKC')).replace(/\s+/g, ' ');
}

function bare(text: string): string {
  return text.replace(/\s+/g, '');
}

async function pdfWords(doc: PDFDocumentProxy): Promise<PdfWord[]> {
  const { Util } = await loadPdfJs();
  const words: PdfWord[] = [];
  for (let number = 1; number <= Math.min(doc.numPages, MAX_PAGES); number++) {
    const page = await doc.getPage(number);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    for (const item of content.items) {
      if (!('str' in item) || item.str === '') continue;
      const [, , c = 0, d = 0, e = 0, f = 0] = Util.transform(viewport.transform, item.transform);
      const height = Math.hypot(c, d);
      words.push({
        page: number,
        text: plainCjk(item.hasEOL ? `${item.str} ` : item.str),
        rect: {
          x: e / viewport.width,
          y: (f - height) / viewport.height,
          width: item.width / viewport.width,
          height: height / viewport.height,
        },
      });
    }
  }
  return words;
}

function textIn(words: readonly PdfWord[], page: number | undefined, rect: ArtifactRect): string {
  return words
    .filter((word) => {
      const cx = word.rect.x + word.rect.width / 2;
      const cy = word.rect.y + word.rect.height / 2;
      return (
        word.page === page &&
        cx >= rect.x &&
        cx <= rect.x + rect.width &&
        cy >= rect.y &&
        cy <= rect.y + rect.height
      );
    })
    .map((word) => word.text)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function findText(
  words: readonly PdfWord[],
  text: string,
): { page: number; rect: ArtifactRect } | null {
  const needle = bare(plainCjk(text)).slice(0, MATCH_CHARS);
  if (needle === '') return null;
  const pages = new Set(words.map((word) => word.page));
  for (const page of pages) {
    const onPage = words.filter((word) => word.page === page && bare(word.text) !== '');
    const joined = onPage.map((word) => bare(word.text)).join('');
    const at = joined.indexOf(needle);
    if (at === -1) continue;
    let offset = 0;
    const hit = onPage.filter((word) => {
      const start = offset;
      offset += bare(word.text).length;
      return offset > at && start < at + needle.length;
    });
    const left = Math.min(...hit.map((word) => word.rect.x));
    const top = Math.min(...hit.map((word) => word.rect.y));
    const right = Math.max(...hit.map((word) => word.rect.x + word.rect.width));
    const bottom = Math.max(...hit.map((word) => word.rect.y + word.rect.height));
    return { page, rect: { x: left, y: top, width: right - left, height: bottom - top } };
  }
  return null;
}

function useBox() {
  const [element, ref] = useState<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined)
        setBox({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return { element, ref, ...box };
}

export function isDeck(sizes: readonly PageSize[]): boolean {
  return sizes.length > 1 && sizes.every((size) => size.width > size.height);
}

function deckFitScale(size: PageSize, box: { width: number; height: number }): number {
  return Math.max(
    0.1,
    Math.min(
      (box.width - PAGE_GAP * 2) / (size.width * CSS_UNITS),
      (box.height - PAGE_GAP * 2) / (size.height * CSS_UNITS),
    ),
  );
}

function useFullscreen(element: HTMLElement | null): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const sync = () => setOn(element !== null && document.fullscreenElement === element);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, [element]);
  return on;
}

export function pdfFitScale(sizes: readonly PageSize[], width: number): number {
  const widest = Math.max(1, ...sizes.map((size) => size.width));
  return Math.max(0.1, (width - PAGE_GAP * 2) / (widest * CSS_UNITS));
}

export function PdfViewer({
  src,
  zoom,
  onFitScale,
  onChange,
  onPages,
}: {
  src: string;
  zoom: Zoom;
  onFitScale: (scale: number) => void;
  onChange: (next: Zoom) => void;
  onPages?: (count: number) => void;
}) {
  const { t } = useI18n();
  const bytesQ = useFileBytes(src);
  const { opened, failed } = useOpenedPdf(bytesQ.data);
  const { element, ref, width } = useBox();
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  const deck = opened !== null && isDeck(opened.sizes);
  const fit = opened === null || width === 0 || deck ? 1 : pdfFitScale(opened.sizes, width);
  useEffect(() => {
    if (!deck) onFitScale(fit);
  }, [deck, fit, onFitScale]);
  const report = useCommentLayer()?.report;
  useEffect(() => {
    if (opened === null) return;
    onPages?.(opened.doc.numPages);
    report?.({ pages: opened.doc.numPages });
    let live = true;
    void pdfWords(opened.doc).then(
      (words) => {
        if (!live) return;
        report?.({
          textIn: (page, rect) => textIn(words, page, rect),
          findText: (text) => findText(words, text),
        });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [opened, onPages, report]);
  const scale = zoom === 'fit' ? fit : zoom;
  usePinchZoom({ stage: deck ? null : element, content, scale, onChange });
  if (bytesQ.isError || failed)
    return (
      <EmptyState
        testId="artifact-pdf-error"
        icon={FileWarning}
        title={t('PDF 未能打开，请下载查看')}
        className="mt-[12vh]"
      />
    );
  if (opened !== null && deck)
    return <PdfDeck opened={opened} zoom={zoom} onFitScale={onFitScale} onChange={onChange} />;
  return (
    <div
      ref={ref}
      data-testid="artifact-pdf"
      data-pages={opened?.doc.numPages}
      className="min-h-0 flex-1 overflow-auto overscroll-contain bg-(--surface-1)"
    >
      {opened === null ? (
        <Skeleton
          data-testid="artifact-pdf-loading"
          className="mx-auto my-4 aspect-[1/1.414] w-full max-w-2xl rounded-none"
        />
      ) : (
        <div ref={setContent} className="flex w-max min-w-full flex-col items-center gap-4 p-4">
          {opened.sizes.map((size, index) => (
            <PdfPage
              key={index}
              pdfjs={opened.pdfjs}
              doc={opened.doc}
              number={index + 1}
              size={size}
              scale={scale}
            />
          ))}
          {opened.doc.numPages > MAX_PAGES && (
            <p className="m-0 text-meta text-content-tertiary">
              {t('只显示前 {n} 页，下载查看全部', { n: MAX_PAGES })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function PdfPage({
  pdfjs,
  doc,
  number,
  size,
  scale,
  textLayer = true,
}: {
  pdfjs: PdfJs;
  doc: PDFDocumentProxy;
  number: number;
  size: PageSize;
  scale: number;
  textLayer?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);
  const [drawn, setDrawn] = useState(false);
  const cssScale = scale * CSS_UNITS;
  useEffect(() => {
    const canvas = canvasRef.current;
    const text = textRef.current;
    if (canvas === null || text === null) return;
    let live = true;
    let task: ReturnType<PDFPageProxy['render']> | null = null;
    void doc.getPage(number).then(async (page) => {
      if (!live) return;
      const viewport = page.getViewport({ scale: cssScale });
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      task = page.render({
        canvas,
        viewport,
        ...(ratio === 1 ? {} : { transform: [ratio, 0, 0, ratio, 0, 0] }),
      });
      try {
        await task.promise;
      } catch {
        return;
      }
      if (!live) return;
      setDrawn(true);
      text.replaceChildren();
      if (!textLayer) return;
      await new pdfjs.TextLayer({
        textContentSource: page.streamTextContent(),
        container: text,
        viewport,
      }).render();
    });
    return () => {
      live = false;
      task?.cancel();
    };
  }, [pdfjs, doc, number, cssScale, textLayer]);
  const style = {
    width: size.width * cssScale,
    height: size.height * cssScale,
    '--scale-factor': cssScale,
    '--total-scale-factor': cssScale,
    '--scale-round-x': '1px',
    '--scale-round-y': '1px',
  } as CSSProperties;
  return (
    <div
      data-testid="artifact-pdf-page"
      data-page={number}
      style={style}
      className="relative flex-none bg-(--page-preview) shadow-(--e1)"
    >
      <canvas ref={canvasRef} className="absolute inset-0 size-full" />
      <div ref={textRef} className="textLayer" />
      {!drawn && <Skeleton className="absolute inset-0 rounded-none" />}
      {textLayer && drawn && <RegionSurface page={number} />}
    </div>
  );
}

function PdfDeck({
  opened,
  zoom,
  onFitScale,
  onChange,
}: {
  opened: Opened;
  zoom: Zoom;
  onFitScale: (scale: number) => void;
  onChange: (next: Zoom) => void;
}) {
  const { t } = useI18n();
  const count = opened.sizes.length;
  const [current, setCurrent] = useState(0);
  const stage = useBox();
  const [deckShell, setDeckShell] = useState<HTMLDivElement | null>(null);
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  const presenting = useFullscreen(deckShell);
  const size = opened.sizes[current] ?? opened.sizes[0] ?? { width: 4, height: 3 };
  const fit = stage.width === 0 ? MIN_ZOOM : deckFitScale(size, stage);
  useEffect(() => onFitScale(fit), [fit, onFitScale]);
  const scale = zoom === 'fit' ? fit : zoom;
  usePinchZoom({ stage: stage.element, content, scale, onChange });
  const go = (next: number) => setCurrent(Math.min(count - 1, Math.max(0, next)));
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (root === null) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const step = DECK_KEYS[event.key];
      if (step === undefined) return;
      event.preventDefault();
      setCurrent((at) => Math.min(count - 1, Math.max(0, at + step)));
    };
    root.addEventListener('keydown', onKeyDown);
    return () => root.removeEventListener('keydown', onKeyDown);
  }, [root, count]);
  return (
    <div
      ref={setRoot}
      data-testid="artifact-pdf"
      data-pages={opened.doc.numPages}
      data-layout="deck"
      className="flex min-h-0 flex-1 bg-(--surface-1)"
    >
      <nav
        aria-label={t('幻灯片')}
        className="flex w-36 flex-none flex-col gap-2 overflow-y-auto overscroll-contain border-r border-border p-3 max-[760px]:hidden"
      >
        {opened.sizes.map((thumb, index) => (
          <Button
            key={index}
            variant="ghost"
            data-testid="artifact-deck-thumb"
            aria-current={index === current ? 'true' : undefined}
            aria-label={t('第 {n} 页', { n: index + 1 })}
            onClick={() => go(index)}
            className={`h-auto flex-none items-start justify-start gap-1.5 p-1 text-meta text-content-tertiary tabular-nums ${index === current ? 'bg-(--hover-1) text-foreground' : ''}`}
          >
            <span className="w-3 flex-none text-right">{index + 1}</span>
            <PdfPage
              pdfjs={opened.pdfjs}
              doc={opened.doc}
              number={index + 1}
              size={thumb}
              scale={96 / (thumb.width * CSS_UNITS)}
              textLayer={false}
            />
          </Button>
        ))}
      </nav>
      <div
        ref={setDeckShell}
        className={`relative flex min-h-0 min-w-0 flex-1 ${presenting ? 'bg-(--lightbox-scrim)' : ''}`}
      >
        <div
          ref={stage.ref}
          data-testid="artifact-deck-stage"
          data-current={current + 1}
          className="flex min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain p-4"
        >
          <div ref={setContent} className="m-auto flex-none">
            <PdfPage
              key={current}
              pdfjs={opened.pdfjs}
              doc={opened.doc}
              number={current + 1}
              size={size}
              scale={scale}
            />
          </div>
        </div>
        <div className="absolute right-3 bottom-3 flex items-center gap-0.5 rounded-(--radius-control) bg-popover p-0.5 shadow-(--e1)">
          <IconTooltip
            label={t('上一页')}
            side="top"
            trigger={
              <Button
                variant="ghost"
                size="icon-sm"
                data-testid="artifact-deck-prev"
                disabled={current === 0}
                onClick={() => go(current - 1)}
              />
            }
          >
            <ChevronLeft aria-hidden className="size-4" />
          </IconTooltip>
          <span
            data-testid="artifact-deck-position"
            className="min-w-10 text-center text-meta text-content-secondary tabular-nums"
          >
            {current + 1} / {count}
          </span>
          <IconTooltip
            label={t('下一页')}
            side="top"
            trigger={
              <Button
                variant="ghost"
                size="icon-sm"
                data-testid="artifact-deck-next"
                disabled={current === count - 1}
                onClick={() => go(current + 1)}
              />
            }
          >
            <ChevronRight aria-hidden className="size-4" />
          </IconTooltip>
          {!presenting && (
            <IconTooltip
              label={t('放映')}
              side="top"
              trigger={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  data-testid="artifact-deck-present"
                  onClick={() => {
                    root?.querySelector<HTMLElement>('[data-testid="artifact-deck-next"]')?.focus();
                    void deckShell?.requestFullscreen();
                  }}
                />
              }
            >
              <Play aria-hidden className="size-4" />
            </IconTooltip>
          )}
        </div>
      </div>
    </div>
  );
}
