import type * as PeleLazy from 'pele/lazy';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { MIN_ZOOM, usePinchZoom, type Zoom } from '../board/artifact/viewers/zoom.js';
import { useI18n } from '../i18n/provider.js';

const DRAWN_TYPES = new Set(['flowchart', 'sequence', 'state']);

type Pele = typeof PeleLazy;
type Failure = 'unsupported' | 'syntax' | 'limit' | 'load';
type Outcome = 'drawn' | Failure;

let peleModule: Promise<Pele> | null = null;

function loadPele(): Promise<Pele> {
  peleModule ??= import('pele/lazy').catch((error: unknown) => {
    peleModule = null;
    throw error;
  });
  return peleModule;
}

function drawnType(pele: Pele, text: string): PeleLazy.DiagramType | null {
  try {
    const type = pele.detectType(text);
    return type !== null && DRAWN_TYPES.has(type) ? type : null;
  } catch {
    return null;
  }
}

function failureOf(pele: Pele | null, error: unknown): Failure {
  if (pele === null || !(error instanceof pele.PeleError)) return 'load';
  if (error.code === 'unsupported-diagram') return 'unsupported';
  if (error.code === 'limit') return 'limit';
  return 'syntax';
}

const FAILURE_NOTICE: Record<Failure, string> = {
  unsupported: '暂不支持这种图表，显示源码',
  syntax: '图表语法有误，显示源码',
  limit: '图表太大，显示源码',
  load: '图表未能加载，显示源码',
};

interface Drawing {
  live: boolean;
  mounted: PeleLazy.Mounted | null;
  settle: (result: Outcome) => void;
}

async function draw(element: HTMLElement, text: string, drawing: Drawing): Promise<void> {
  let pele: Pele | null = null;
  try {
    pele = await loadPele();
    const type = drawnType(pele, text);
    if (type === null) return drawing.settle('unsupported');
    await pele.load(type);
    if (!drawing.live) return;
    const loaded = pele;
    drawing.mounted = loaded.mount(element, text, {
      zoom: false,
      onRender: () => drawing.settle('drawn'),
      onError: (error) => drawing.settle(failureOf(loaded, error)),
    });
  } catch (error) {
    drawing.settle(failureOf(pele, error));
  }
}

function useDiagram(text: string, final: boolean) {
  const host = useRef<HTMLDivElement>(null);
  const [outcome, setOutcome] = useState<{ text: string; result: Outcome } | null>(null);
  useEffect(() => {
    const element = host.current;
    if (element === null || !final) return;
    const drawing: Drawing = {
      live: true,
      mounted: null,
      settle: (result) => {
        if (drawing.live) setOutcome({ text, result });
      },
    };
    void draw(element, text, drawing);
    return () => {
      drawing.live = false;
      drawing.mounted?.destroy();
      element.replaceChildren();
    };
  }, [text, final]);
  return { host, outcome: outcome !== null && outcome.text === text ? outcome.result : null };
}

export function MermaidBlock({
  text,
  source,
  final,
}: {
  text: string;
  source: ReactNode;
  final: boolean;
}) {
  const { t } = useI18n();
  const { host, outcome } = useDiagram(text, final);
  const failure: Failure | null = outcome !== null && outcome !== 'drawn' ? outcome : null;
  const drawn = outcome === 'drawn';
  return (
    <div
      className="relative flex min-w-0 flex-col gap-1.5"
      data-testid="md-mermaid"
      data-state={final ? (failure ?? (drawn ? 'drawn' : 'pending')) : 'streaming'}
    >
      <div
        ref={host}
        role="img"
        aria-label={t('图表')}
        hidden={failure !== null}
        className="chat-md-diagram w-(--container-reply-bubble) max-w-full overflow-x-auto overscroll-x-contain rounded-(--radius-code) border border-border bg-background p-4 data-[pending]:invisible data-[pending]:absolute"
        data-testid="md-mermaid-diagram"
        {...(drawn ? {} : { 'data-pending': '' })}
      />
      {!drawn && source}
      {failure !== null && (
        <p className="m-0 text-meta text-(--text-tertiary)" data-testid="md-mermaid-notice">
          {t(FAILURE_NOTICE[failure])}
        </p>
      )}
    </div>
  );
}

export function DiagramView({
  text,
  source,
  zoom = 'fit',
  onFitScale,
  onZoomChange,
}: {
  text: string;
  source: ReactNode;
  zoom?: Zoom;
  onFitScale?: (scale: number) => void;
  onZoomChange?: (next: Zoom) => void;
}) {
  const { t } = useI18n();
  const { host, outcome } = useDiagram(text, true);
  const failure: Failure | null = outcome !== null && outcome !== 'drawn' ? outcome : null;
  const drawn = outcome === 'drawn';
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [fitScale, setFitScale] = useState(1);

  useEffect(() => {
    if (!drawn || host.current === null) {
      setNatural(null);
      return;
    }
    const svg = host.current.querySelector('svg');
    if (svg === null) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setNatural({ width: rect.width, height: rect.height });
    }
  }, [drawn, host]);

  useEffect(() => {
    if (stage === null || natural === null) return;
    const measure = () => {
      const next = Math.max(
        MIN_ZOOM,
        Math.min(
          1,
          (stage.clientWidth - 48) / natural.width,
          (stage.clientHeight - 48) / natural.height,
        ),
      );
      setFitScale(next);
      onFitScale?.(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [stage, natural, onFitScale]);

  const scale = zoom === 'fit' ? fitScale : zoom;
  usePinchZoom({
    stage,
    content,
    scale,
    onChange: (next) => onZoomChange?.(next),
  });

  const scaled = drawn && natural !== null && zoom !== 'fit';
  return (
    <div
      ref={setStage}
      data-testid="artifact-diagram"
      data-state={failure ?? (drawn ? 'drawn' : 'pending')}
      className="relative flex min-h-0 flex-1 flex-col overflow-auto overscroll-contain"
    >
      {failure !== null && (
        <p
          data-testid="artifact-diagram-notice"
          role="status"
          className="m-0 flex-none border-b border-border bg-(--surface-1) px-4 py-2 text-ui text-content-secondary"
        >
          {t(FAILURE_NOTICE[failure])}
        </p>
      )}
      <div
        ref={setContent}
        className="m-auto flex-none p-6"
        style={
          scaled
            ? { width: natural.width * scale + 48, height: natural.height * scale + 48 }
            : undefined
        }
      >
        <div
          ref={host}
          role="img"
          aria-label={t('图表')}
          hidden={failure !== null}
          className="chat-md-diagram origin-top-left data-[pending]:invisible"
          style={scaled ? { transform: `scale(${scale})`, width: natural.width } : undefined}
          {...(drawn ? {} : { 'data-pending': '' })}
        />
      </div>
      {failure !== null && source}
    </div>
  );
}
