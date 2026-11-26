// SPDX-License-Identifier: Apache-2.0. Modified by Cairn from nexu-io/open-design@07258801 apps/daemon/src/document-preview.ts
import { basename } from 'node:path';
import {
  readZipEntries,
  readZipEntryText,
  type ZipEntry,
  type ZipReadBudget,
  ZipReadError,
} from './zip-entries.js';

const MAX_COMPRESSED_PREVIEW_BYTES = 10 * 1024 * 1024;
const MAX_UNCOMPRESSED_PREVIEW_BYTES = 50 * 1024 * 1024;
const MAX_XML_ENTRY_BYTES = 5 * 1024 * 1024;

export type DocumentPreviewKind = 'document' | 'presentation' | 'spreadsheet';
export interface DocumentPreviewSection {
  title: string;
  lines: string[];
}
export interface DocumentPreview {
  kind: DocumentPreviewKind;
  title: string;
  sections: DocumentPreviewSection[];
}
type XmlAttrs = Record<string, string>;
type WorkbookSheet = { name: string; path: string };
type Zip = { buffer: Buffer; entries: Map<string, ZipEntry>; budget: ZipReadBudget };

export class DocumentPreviewError extends Error {
  readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'DocumentPreviewError';
  }
}

export function documentPreviewKindOf(fileName: string): DocumentPreviewKind | null {
  const ext = fileName.toLowerCase().split('.').pop();
  if (ext === 'docx') return 'document';
  if (ext === 'pptx') return 'presentation';
  if (ext === 'xlsx') return 'spreadsheet';
  return null;
}

export function buildDocumentPreview(file: { name: string; buffer: Buffer }): DocumentPreview {
  const kind = documentPreviewKindOf(file.name);
  if (kind === null) throw new DocumentPreviewError('unsupported preview type', 415);
  if (file.buffer.length > MAX_COMPRESSED_PREVIEW_BYTES) {
    throw new DocumentPreviewError('document too large to preview', 413);
  }
  let zip: Zip;
  try {
    zip = {
      buffer: file.buffer,
      entries: readZipEntries(file.buffer),
      budget: {
        maxEntryBytes: MAX_XML_ENTRY_BYTES,
        remainingBytes: MAX_UNCOMPRESSED_PREVIEW_BYTES,
      },
    };
  } catch (error) {
    if (error instanceof ZipReadError)
      throw new DocumentPreviewError(error.message, error.statusCode);
    throw error;
  }
  assertZipPreviewSize(zip);
  const title = basename(file.name);
  if (kind === 'document') return { kind, title, sections: previewDocx(zip) };
  if (kind === 'presentation') return { kind, title, sections: previewPptx(zip) };
  return { kind, title, sections: previewXlsx(zip) };
}

function previewDocx(zip: Zip): DocumentPreviewSection[] {
  const xml = readZipText(zip, 'word/document.xml');
  return [{ title: 'Document', lines: extractParagraphs(xml) }];
}

function previewPptx(zip: Zip): DocumentPreviewSection[] {
  const slideNames = [...zip.entries.keys()]
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort(numericPathSort);
  return slideNames.map((name, i) => ({
    title: `Slide ${i + 1}`,
    lines: extractTextRuns(readZipText(zip, name)),
  }));
}

function previewXlsx(zip: Zip): DocumentPreviewSection[] {
  const sharedStrings = readSharedStrings(zip);
  return readWorkbook(zip).map((sheet) => ({
    title: sheet.name,
    lines: extractWorksheetRows(readZipTextOrEmpty(zip, sheet.path), sharedStrings),
  }));
}

function readSharedStrings(zip: Zip): string[] {
  const xml = readZipTextOrEmpty(zip, 'xl/sharedStrings.xml');
  if (!xml) return [];
  return xmlElements(xml, 'si').map((si) => extractTextRuns(si.body).join(''));
}

function readWorkbook(zip: Zip): WorkbookSheet[] {
  const workbookXml = readZipTextOrEmpty(zip, 'xl/workbook.xml');
  const relsXml = readZipTextOrEmpty(zip, 'xl/_rels/workbook.xml.rels');
  const rels = new Map<string, string>();
  for (const rel of xmlElements(relsXml, 'Relationship')) {
    const attrs = parseAttrs(rel.attrs);
    if (attrs.Id && attrs.Target) rels.set(attrs.Id, attrs.Target);
  }
  const sheets: WorkbookSheet[] = [];
  for (const sheet of xmlElements(workbookXml, 'sheet')) {
    const attrs = parseAttrs(sheet.attrs);
    const relId = attrs['r:id'];
    const target = relId ? rels.get(relId) : null;
    if (!target) continue;
    sheets.push({
      name: attrs.name || `Sheet ${sheets.length + 1}`,
      path: `xl/${target.replace(/^\/?xl\//, '')}`,
    });
  }
  if (sheets.length > 0) return sheets;
  return [...zip.entries.keys()]
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort(numericPathSort)
    .map((name, i) => ({ name: `Sheet ${i + 1}`, path: name }));
}

function extractWorksheetRows(xml: string, sharedStrings: string[]): string[] {
  const rows: string[] = [];
  for (const row of xmlElements(xml, 'row')) {
    const values: string[] = [];
    for (const cell of xmlElements(row.body, 'c')) {
      const attrs = parseAttrs(cell.attrs);
      const body = cell.body;
      let value: string;
      if (attrs.t === 's') {
        const idx = Number(firstBody(body, 'v'));
        value = Number.isInteger(idx) ? (sharedStrings[idx] ?? '') : '';
      } else if (attrs.t === 'inlineStr') {
        value = extractTextRuns(body).join('');
      } else {
        value = decodeXml(firstBody(body, 'v'));
      }
      if (value.trim()) values.push(value.trim());
    }
    if (values.length > 0) rows.push(values.join(' | '));
  }
  return rows;
}

function extractParagraphs(xml: string): string[] {
  return xmlElements(xml, 'w:p')
    .map((p) => extractTextRuns(p.body).join(' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

const TEXT_RUN_TAGS = ['a:t', 'w:t', 't'] as const;

function extractTextRuns(xml: string): string[] {
  const tag = TEXT_RUN_TAGS.find((name) => xml.includes(`<${name}`)) ?? 't';
  return xmlElements(xml, tag)
    .map((run) => decodeXml(run.body).trim())
    .filter(Boolean);
}

const MAX_TAG_ATTRS_CHARS = 4096;
const TAG_NAME_END = new Set([' ', '>', '/', '\t', '\n', '\r']);

function xmlElements(xml: string, tag: string): { attrs: string; body: string }[] {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  const out: { attrs: string; body: string }[] = [];
  let at = 0;
  for (;;) {
    const start = xml.indexOf(open, at);
    if (start < 0) return out;
    at = start + open.length;
    if (!TAG_NAME_END.has(xml[at] ?? '')) continue;
    const tagEnd = xml.indexOf('>', at);
    if (tagEnd < 0) return out;
    const rawAttrs = xml.slice(at, tagEnd);
    at = tagEnd + 1;
    const attrs = rawAttrs.length > MAX_TAG_ATTRS_CHARS ? '' : rawAttrs;
    if (rawAttrs.endsWith('/')) {
      out.push({ attrs: attrs.slice(0, -1), body: '' });
      continue;
    }
    const end = xml.indexOf(close, at);
    if (end < 0) return out;
    out.push({ attrs, body: xml.slice(at, end) });
    at = end + close.length;
  }
}

function firstBody(xml: string, tag: string): string {
  return xmlElements(xml, tag)[0]?.body ?? '';
}

function readZipText(zip: Zip, name: string): string {
  const entry = zip.entries.get(name);
  if (!entry) throw new DocumentPreviewError(`missing ${name}`, 422);
  let xml: string;
  try {
    xml = readZipEntryText(zip.buffer, entry, zip.budget);
  } catch (error) {
    if (error instanceof ZipReadError)
      throw new DocumentPreviewError(error.message, error.statusCode);
    throw new DocumentPreviewError('corrupt document', 422);
  }
  if (/<!DOCTYPE\b|<!ENTITY\b/i.test(xml)) {
    throw new DocumentPreviewError('unsupported XML entities', 415);
  }
  return xml;
}

function readZipTextOrEmpty(zip: Zip, name: string): string {
  return zip.entries.has(name) ? readZipText(zip, name) : '';
}

function parseAttrs(raw: string): XmlAttrs {
  const attrs: XmlAttrs = {};
  for (const m of raw.matchAll(/(?<![\w:-])([\w:-]+)="([^"]*)"/g)) {
    const name = m[1];
    if (name) attrs[name] = decodeXml(m[2] ?? '');
  }
  return attrs;
}

function decodeXml(raw: unknown): string {
  return String(raw)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function assertZipPreviewSize(zip: Zip): void {
  let total = 0;
  for (const entry of zip.entries.values()) {
    total += entry.uncompressedSize;
    if (total > MAX_UNCOMPRESSED_PREVIEW_BYTES) {
      throw new DocumentPreviewError('document too large to preview', 413);
    }
  }
}

function numericPathSort(a: string, b: string): number {
  const an = Number(a.match(/(?<!\d)(\d+)(?=\.xml$)/)?.[1] ?? 0);
  const bn = Number(b.match(/(?<!\d)(\d+)(?=\.xml$)/)?.[1] ?? 0);
  return an - bn || a.localeCompare(b);
}
