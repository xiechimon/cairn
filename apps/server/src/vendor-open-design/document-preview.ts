// SPDX-License-Identifier: Apache-2.0. Modified by Cairn from nexu-io/open-design@07258801 apps/daemon/src/document-preview.ts
import { basename } from 'node:path';
import { readZipEntries, readZipEntryText, type ZipEntry, ZipReadError } from './zip-entries.js';

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
type Zip = { buffer: Buffer; entries: Map<string, ZipEntry> };

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
    zip = { buffer: file.buffer, entries: readZipEntries(file.buffer) };
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
  const paragraphs = extractParagraphs(xml, /<w:p\b[\s\S]*?<\/w:p>/g);
  return [{ title: 'Document', lines: paragraphs }];
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
  return Array.from(xml.matchAll(/<si\b[\s\S]*?<\/si>/g)).map((m) =>
    extractTextRuns(m[0]).join(''),
  );
}

function readWorkbook(zip: Zip): WorkbookSheet[] {
  const workbookXml = readZipTextOrEmpty(zip, 'xl/workbook.xml');
  const relsXml = readZipTextOrEmpty(zip, 'xl/_rels/workbook.xml.rels');
  const rels = new Map<string, string>();
  for (const rel of relsXml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const attrs = parseAttrs(rel[1] ?? '');
    if (attrs.Id && attrs.Target) rels.set(attrs.Id, attrs.Target);
  }
  const sheets: WorkbookSheet[] = [];
  for (const sheet of workbookXml.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const attrs = parseAttrs(sheet[1] ?? '');
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
  for (const row of xml.matchAll(/<row\b[\s\S]*?<\/row>/g)) {
    const values: string[] = [];
    for (const cell of row[0].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = parseAttrs(cell[1] ?? '');
      const body = cell[2] ?? '';
      let value: string;
      if (attrs.t === 's') {
        const idx = Number(extractFirst(body, /<v>([\s\S]*?)<\/v>/));
        value = Number.isInteger(idx) ? (sharedStrings[idx] ?? '') : '';
      } else if (attrs.t === 'inlineStr') {
        value = extractTextRuns(body).join('');
      } else {
        value = decodeXml(extractFirst(body, /<v>([\s\S]*?)<\/v>/));
      }
      if (value.trim()) values.push(value.trim());
    }
    if (values.length > 0) rows.push(values.join(' | '));
  }
  return rows;
}

function extractParagraphs(xml: string, paragraphPattern: RegExp): string[] {
  return Array.from(xml.matchAll(paragraphPattern))
    .map((m) => extractTextRuns(m[0]).join(' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function extractTextRuns(xml: string): string[] {
  return Array.from(
    xml.matchAll(
      /<a:t[^>]*>([\s\S]*?)<\/a:t>|<w:t[^>]*>([\s\S]*?)<\/w:t>|<t[^>]*>([\s\S]*?)<\/t>/g,
    ),
  )
    .map((m) => decodeXml(m[1] ?? m[2] ?? m[3] ?? '').trim())
    .filter(Boolean);
}

function readZipText(zip: Zip, name: string): string {
  const entry = zip.entries.get(name);
  if (!entry) throw new DocumentPreviewError(`missing ${name}`, 422);
  if (entry.uncompressedSize > MAX_XML_ENTRY_BYTES) {
    throw new DocumentPreviewError('document section too large to preview', 413);
  }
  let xml: string;
  try {
    xml = readZipEntryText(zip.buffer, entry);
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
  for (const m of raw.matchAll(/([\w:-]+)="([^"]*)"/g)) {
    const name = m[1];
    if (name) attrs[name] = decodeXml(m[2] ?? '');
  }
  return attrs;
}

function extractFirst(raw: string, pattern: RegExp): string {
  const m = raw.match(pattern);
  return m ? (m[1] ?? '') : '';
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
  const an = Number(a.match(/(\d+)(?=\.xml$)/)?.[1] ?? 0);
  const bn = Number(b.match(/(\d+)(?=\.xml$)/)?.[1] ?? 0);
  return an - bn || a.localeCompare(b);
}
