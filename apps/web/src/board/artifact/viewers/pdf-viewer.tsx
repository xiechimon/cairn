import { FileWarning } from 'lucide-react';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { EmptyState } from '../../../components/empty-state.js';
import { Skeleton } from '../../../components/ui/skeleton.js';
import { useI18n } from '../../../i18n/provider.js';
import { useFileBytes } from './use-file-bytes.js';
import type { Zoom } from './zoom.js';

type PdfJs = typeof import('pdfjs-dist');

const CSS_UNITS = 96 / 72;
const PAGE_GAP = 16;
const MAX_PAGES = 300;

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

function useWidth() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

export function pdfFitScale(sizes: readonly PageSize[], width: number): number {
  const widest = Math.max(1, ...sizes.map((size) => size.width));
  return Math.max(0.1, (width - PAGE_GAP * 2) / (widest * CSS_UNITS));
}

export function PdfViewer({
  src,
  zoom,
  onFitScale,
  onPages,
}: {
  src: string;
  zoom: Zoom;
  onFitScale: (scale: number) => void;
  onPages?: (count: number) => void;
}) {
  const { t } = useI18n();
  const bytesQ = useFileBytes(src);
  const { opened, failed } = useOpenedPdf(bytesQ.data);
  const { ref, width } = useWidth();
  const fit = opened === null || width === 0 ? 1 : pdfFitScale(opened.sizes, width);
  useEffect(() => onFitScale(fit), [fit, onFitScale]);
  useEffect(() => {
    if (opened !== null) onPages?.(opened.doc.numPages);
  }, [opened, onPages]);
  const scale = zoom === 'fit' ? fit : zoom;
  if (bytesQ.isError || failed)
    return (
      <EmptyState
        testId="artifact-pdf-error"
        icon={FileWarning}
        title={t('PDF 未能打开，请下载查看')}
        className="mt-[12vh]"
      />
    );
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
        <div className="flex w-max min-w-full flex-col items-center gap-4 p-4">
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
}: {
  pdfjs: PdfJs;
  doc: PDFDocumentProxy;
  number: number;
  size: PageSize;
  scale: number;
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
  }, [pdfjs, doc, number, cssScale]);
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
    </div>
  );
}
