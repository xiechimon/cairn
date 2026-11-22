import type { TodoDeliverables } from '@cairn/shared';
import { useQuery } from '@tanstack/react-query';
import { Globe, Presentation } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../components/ui/button.js';
import { Skeleton } from '../components/ui/skeleton.js';
import { useI18n } from '../i18n/provider.js';
import { Download } from '../icons/index.js';

type Deliverable = TodoDeliverables['items'][number];

const THUMB_SKELETON_DELAY_MS = 200;

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

export function pageThumbnailHref(id: string): string {
  return `/api/attachments/${encodeURIComponent(id)}/thumbnail`;
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
    select: classifyPage,
    queryFn: async () => {
      const res = await fetch(deliverableHref(id ?? ''), { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`page ${res.status}`);
      return res.text();
    },
  });
}

const ACTIVE_TAGS = new Set([
  'script',
  'noscript',
  'iframe',
  'frame',
  'object',
  'embed',
  'applet',
  'portal',
]);

const SCRIPT_URL = /(?:java|vb)script:/;

function activeIn(root: ParentNode): boolean {
  for (const el of root.querySelectorAll('*')) {
    if (ACTIVE_TAGS.has(el.localName.toLowerCase())) return true;
    for (const attr of el.attributes) {
      if (attr.name.toLowerCase().startsWith('on')) return true;
      if (SCRIPT_URL.test(attr.value.replace(/[\t\n\r]/g, '').toLowerCase())) return true;
    }
    if (el instanceof HTMLTemplateElement && activeIn(el.content)) return true;
  }
  return false;
}

function classifyPage(html: string): { html: string; scripted: boolean } {
  return { html, scripted: activeIn(new DOMParser().parseFromString(html, 'text/html')) };
}

export function PageThumb({ src, onFail }: { src: string; onFail: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setWaiting(true), THUMB_SKELETON_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div
      aria-hidden="true"
      data-testid="made-card-thumb"
      className="relative size-full overflow-hidden rounded-(--radius-tile) border border-border bg-(--page-preview)"
    >
      {!loaded && waiting && <Skeleton className="absolute inset-0 rounded-none" />}
      <img
        src={src}
        alt=""
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={onFail}
        className={`size-full object-cover object-top ${loaded ? '' : 'opacity-0'}`}
      />
    </div>
  );
}

function FileRow({
  item,
  note,
  onOpen,
}: {
  item: Deliverable;
  note?: string;
  onOpen?: () => void;
}) {
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
      {onOpen !== undefined && (
        <Button
          variant="outline"
          size="sm"
          data-testid="made-file-open"
          aria-label={`${t('打开')} ${item.name}`}
          className="flex-none"
          onClick={onOpen}
        >
          {t('打开')}
        </Button>
      )}
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

export function MadeFiles({
  deliverables,
  onOpenPage,
}: {
  deliverables: TodoDeliverables | undefined;
  onOpenPage?: (name: string) => void;
}) {
  const { t } = useI18n();
  if (deliverables === undefined) return null;
  const { items, skipped } = deliverables;
  return (
    <div data-testid="made-files" className="mt-5">
      {items.length > 0 && (
        <div className="overflow-hidden rounded-(--radius-card) shadow-(--e1)">
          {items.map((item, index) => (
            <div
              key={item.attachmentId}
              className={index > 0 ? 'border-t border-border' : undefined}
            >
              <FileRow
                item={item}
                {...(item.kind === 'slides' ? { note: t('下载后打开') } : {})}
                {...(item.kind === 'page' && onOpenPage !== undefined
                  ? { onOpen: () => onOpenPage(item.name) }
                  : {})}
              />
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
