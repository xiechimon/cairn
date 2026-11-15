import type { TodoDeliverables } from '@cairn/shared';
import { useQuery } from '@tanstack/react-query';
import { Globe, Presentation } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../components/ui/button.js';
import { useI18n } from '../i18n/provider.js';
import { Download } from '../icons/index.js';

type Deliverable = TodoDeliverables['items'][number];

const PAGE_CSP =
  "default-src 'none'; style-src 'unsafe-inline' data:; img-src data: blob:; font-src data:; media-src data:; base-uri 'none'; form-action 'none'; frame-src 'none'";

const THUMB_WIDTH = 800;

export const THUMB_MAX_BYTES = 256 * 1024;

const SKIP_REASON: Record<string, string> = {
  'unsupported-kind': '不是网页或 PPT',
  'outside-kind-folder': '不是网页或 PPT',
  'too-large': '文件太大',
  'over-size-limit': '超出总大小上限',
  'over-file-limit': '超出文件数上限',
  'too-many-entries': '超出文件数上限',
  'duplicate-name': '和另一个文件重名',
  'upload-rejected': '上传没有成功',
};

export function deliverableHref(id: string): string {
  return `/api/attachments/${encodeURIComponent(id)}?download=1`;
}

export function sizeLabel(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function primaryPage(set: TodoDeliverables | undefined): Deliverable | undefined {
  return set?.items.find((item) => item.kind === 'page');
}

export function usePageHtml(item: Deliverable | undefined, enabled = true) {
  const id = item?.attachmentId ?? null;
  return useQuery({
    queryKey: ['deliverable-html', id],
    enabled: enabled && id !== null,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
    queryFn: async () => {
      const res = await fetch(deliverableHref(id ?? ''), { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`page ${res.status}`);
      return res.text();
    },
  });
}

export function hasScript(html: string): boolean {
  return /<script\b/i.test(html);
}

export function PageFrame({
  html,
  title,
  className,
  inert = false,
}: {
  html: string;
  title: string;
  className?: string;
  inert?: boolean;
}) {
  return (
    <iframe
      data-testid="made-page-frame"
      title={title}
      sandbox=""
      referrerPolicy="no-referrer"
      allow=""
      tabIndex={inert ? -1 : undefined}
      srcDoc={`<meta http-equiv="Content-Security-Policy" content="${PAGE_CSP}">${html}`}
      className={className}
    />
  );
}

export function PageThumb({ html, title }: { html: string; title: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const measure = () => setScale(el.clientWidth / THUMB_WIDTH);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      aria-hidden="true"
      data-testid="made-card-thumb"
      className="relative size-full overflow-hidden rounded-(--radius-tile) border border-border bg-(--page-preview)"
    >
      <div
        className="absolute top-0 left-0 origin-top-left"
        style={{ transform: `scale(${scale})` }}
      >
        <PageFrame
          inert
          html={html}
          title={title}
          className="pointer-events-none h-150 w-200 border-0"
        />
      </div>
    </div>
  );
}

function FileRow({ item, note }: { item: Deliverable; note?: string }) {
  const { t } = useI18n();
  const Icon = item.kind === 'page' ? Globe : Presentation;
  const meta = [item.kind === 'page' ? t('网页') : t('PPT'), sizeLabel(item.sizeBytes), note]
    .filter((part) => part !== undefined)
    .join(' · ');
  return (
    <div data-testid="made-file" className="flex min-h-13 items-center gap-3 py-2 pr-3 pl-3.5">
      <Icon aria-hidden="true" className="size-5 flex-none text-content-secondary" />
      <div className="min-w-0 flex-1">
        <p className="m-0 truncate text-ui text-foreground">{item.name}</p>
        <p className="m-0 truncate text-meta text-content-tertiary">{meta}</p>
      </div>
      <Button
        variant="outline"
        size="sm"
        nativeButton={false}
        render={<a href={deliverableHref(item.attachmentId)} download={item.name} />}
        aria-label={`${t('下载')} ${item.name}`}
        className="flex-none gap-1.5"
      >
        <Download aria-hidden="true" className="size-4" />
        {t('下载')}
      </Button>
    </div>
  );
}

export function MadeFiles({ deliverables }: { deliverables: TodoDeliverables | undefined }) {
  const { t } = useI18n();
  const page = primaryPage(deliverables);
  const html = usePageHtml(page);
  if (deliverables === undefined) return null;
  const { items, skipped } = deliverables;
  const scripted = html.data !== undefined && hasScript(html.data);
  const noteOf = (item: Deliverable) => {
    if (item.kind === 'slides') return t('下载后打开');
    if (item !== page) return undefined;
    return scripted ? t('含脚本，下载后打开') : t('预览不运行脚本');
  };
  return (
    <div data-testid="made-files" className="mt-5">
      {items.length > 0 && (
        <div className="overflow-hidden rounded-(--radius-card) shadow-(--e1)">
          {items.map((item, index) => (
            <div
              key={item.attachmentId}
              className={index > 0 ? 'border-t border-border' : undefined}
            >
              <FileRow item={item} note={noteOf(item)} />
              {item === page && html.data !== undefined && !scripted && (
                <PageFrame
                  html={html.data}
                  title={item.name}
                  className="block h-95 w-full border-t border-border bg-(--page-preview) max-sm:h-75"
                />
              )}
            </div>
          ))}
        </div>
      )}
      {skipped.length > 0 && (
        <p data-testid="made-skipped" className="m-0 mt-2.5 text-meta text-content-tertiary">
          {t('未收录 {n} 个文件：', { n: skipped.length })}
          {skipped.map((s) => `${s.name}（${t(SKIP_REASON[s.reason] ?? '没能读取')}）`).join('、')}
        </p>
      )}
    </div>
  );
}
