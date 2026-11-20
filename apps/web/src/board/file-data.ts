import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router';
import { useLiveData } from '../api/provider.js';
import { attachmentIdFromKey } from '../detail/attachment-chip.js';
import { resolveScenario } from '../fixtures/scenario.js';
import type { DocumentPreview } from '../vendor-open-design/viewers/document-preview-viewer.js';
import { type FileViewerKind, kindFor } from '../vendor-open-design/viewers/file-kind.js';
import { attachmentUrl } from './file-pane.js';

const DOCUMENT_UNAVAILABLE_STATUSES = new Set([413, 415, 422]);

const TILE_PREVIEW_LINES = 8;

export class DocumentPreviewUnavailable extends Error {}

async function fetchAttachmentText(url: string): Promise<string> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`attachment read failed: ${res.status}`);
  return res.text();
}

async function fetchDocumentPreview(url: string): Promise<DocumentPreview> {
  const res = await fetch(`${url}/document-preview`, { credentials: 'same-origin' });
  if (DOCUMENT_UNAVAILABLE_STATUSES.has(res.status))
    throw new DocumentPreviewUnavailable(`document preview unavailable: ${res.status}`);
  if (!res.ok) throw new Error(`document preview failed: ${res.status}`);
  return (await res.json()) as DocumentPreview;
}

async function fetchAttachmentSize(url: string): Promise<number | null> {
  const res = await fetch(url, { method: 'HEAD', credentials: 'same-origin' });
  const length = res.ok ? Number(res.headers.get('content-length')) : Number.NaN;
  return Number.isFinite(length) && length > 0 ? length : null;
}

export interface AttachmentFiles {
  kind: FileViewerKind;
  live: boolean;
  url: string;
  src: string;
  fixture: { text?: string; src?: string; document?: DocumentPreview } | undefined;
  downloadHref: string;
  text: UseQueryResult<string>;
  document: UseQueryResult<DocumentPreview>;
  readsText: boolean;
  readsDocument: boolean;
}

export function useAttachmentFiles(
  key: string,
  { size = false, tile = false }: { size?: boolean; tile?: boolean } = {},
): AttachmentFiles & { size: number | undefined } {
  const { live } = useLiveData();
  const { search } = useLocation();
  const kind = kindFor(key);
  const fixture = live
    ? undefined
    : resolveScenario(new URLSearchParams(search)).attachments?.[attachmentIdFromKey(key)];
  const url = attachmentUrl(key);
  const fixtureText = fixture?.text;
  const readsText =
    (kind === 'markdown' || kind === 'text' || (kind === 'svg' && !tile)) &&
    (!tile || live || fixtureText !== undefined);
  const text = useQuery({
    queryKey: ['attachment-text', key, fixtureText ?? null],
    queryFn: () =>
      fixtureText !== undefined ? Promise.resolve(fixtureText) : fetchAttachmentText(url),
    enabled: readsText,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  const fixtureDocument = fixture?.document;
  const readsDocument = kind === 'document' && (live || fixtureDocument !== undefined);
  const document = useQuery({
    queryKey: ['attachment-document-preview', key, fixtureDocument ?? null],
    queryFn: () =>
      fixtureDocument !== undefined ? Promise.resolve(fixtureDocument) : fetchDocumentPreview(url),
    enabled: readsDocument,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  const sizeQ = useQuery({
    queryKey: ['attachment-size', key],
    queryFn: () => fetchAttachmentSize(url),
    enabled: size && live && (kind === 'document' || kind === 'binary'),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  const downloadHref =
    fixture?.src ??
    (fixtureText !== undefined
      ? `data:text/plain;charset=utf-8,${encodeURIComponent(fixtureText)}`
      : `${url}?download=1`);
  return {
    kind,
    live,
    url,
    src: fixture?.src ?? url,
    fixture,
    downloadHref,
    text,
    document,
    readsText,
    readsDocument,
    size: sizeQ.data ?? undefined,
  };
}

export function useFilePreviewLines(key: string): string[] | undefined {
  const files = useAttachmentFiles(key, { tile: true });
  if (files.kind === 'markdown' || files.kind === 'text') {
    const text = files.text.data;
    return text === undefined
      ? undefined
      : text
          .split('\n')
          .filter((line) => line.trim() !== '')
          .slice(0, TILE_PREVIEW_LINES);
  }
  if (files.kind === 'document') {
    const preview = files.document.data;
    if (preview === undefined) return undefined;
    const lines = [
      ...(preview.kind === 'spreadsheet' ? [] : [preview.title]),
      ...preview.sections.flatMap((section) => section.lines),
    ];
    return lines.filter((line) => line.trim() !== '').slice(0, TILE_PREVIEW_LINES);
  }
  return undefined;
}
