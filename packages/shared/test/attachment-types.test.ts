import { describe, expect, test } from 'vitest';
import {
  ATTACHMENT_ACCEPT,
  attachmentExtOf,
  attachmentKindOf,
  isAllowedAttachmentExt,
  isInlineAttachment,
  resolveAttachmentMime,
  servedAttachmentMime,
} from '../src/attachment-types.js';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

describe('attachment type allowlist', () => {
  test.each([
    'xlsx',
    'xls',
    'docx',
    'doc',
    'pptx',
    'ppt',
    'csv',
    'tsv',
    'pdf',
    'md',
    'txt',
    'json',
    'yaml',
    'yml',
    'log',
    'zip',
    'png',
  ])('%s is allowed and in the picker accept list', (ext) => {
    expect(isAllowedAttachmentExt(ext)).toBe(true);
    expect(ATTACHMENT_ACCEPT.split(',')).toContain(`.${ext}`);
  });

  test.each(['exe', 'bin', 'dll', 'xlsm', 'jar', 'app', '', 'constructor'])(
    '%s is rejected',
    (ext) => {
      expect(isAllowedAttachmentExt(ext)).toBe(false);
      expect(resolveAttachmentMime(`file.${ext}`, 'application/octet-stream')).toBeNull();
    },
  );

  test('a name without an extension is rejected', () => {
    expect(resolveAttachmentMime('README', 'text/plain')).toBeNull();
    expect(attachmentExtOf('README')).toBe('');
  });

  test('declared MIME only refines: empty and octet-stream fall back to the canonical type', () => {
    expect(resolveAttachmentMime('a.xlsx', '')).toBe(XLSX);
    expect(resolveAttachmentMime('a.xlsx', 'application/octet-stream')).toBe(XLSX);
    expect(resolveAttachmentMime('a.xlsx', 'text/html')).toBe(XLSX);
    expect(resolveAttachmentMime('a.csv', 'application/vnd.ms-excel')).toBe(
      'application/vnd.ms-excel',
    );
  });

  test('a declared active-content type never survives on a text extension', () => {
    expect(resolveAttachmentMime('a.txt', 'text/html')).toBe('text/plain');
    expect(resolveAttachmentMime('a.txt', 'text/javascript')).toBe('text/plain');
    expect(resolveAttachmentMime('a.png', 'text/html')).toBe('image/png');
  });

  test('declared text types are kept on text extensions', () => {
    expect(resolveAttachmentMime('a.md', 'text/plain')).toBe('text/plain');
    expect(resolveAttachmentMime('a.py', 'text/x-python')).toBe('text/x-python');
    expect(resolveAttachmentMime('a.md', 'text/markdown; charset=utf-8')).toBe('text/markdown');
  });

  test('only png, jpeg, gif, webp and pdf are inline, and only with the canonical type', () => {
    expect(isInlineAttachment('t/a.png', 'image/png')).toBe(true);
    expect(isInlineAttachment('t/a.pdf', 'application/pdf')).toBe(true);
    expect(isInlineAttachment('t/a.png', 'text/html')).toBe(false);
    expect(isInlineAttachment('t/a.svg', 'image/svg+xml')).toBe(false);
    expect(isInlineAttachment('t/a.html', 'text/html')).toBe(false);
    expect(isInlineAttachment('t/a.xlsx', XLSX)).toBe(false);
    expect(isInlineAttachment('t/a.txt', 'text/plain')).toBe(false);
  });

  test('served type derives from the extension, unknown falls back to octet-stream', () => {
    expect(servedAttachmentMime('t/a.xlsx')).toBe(XLSX);
    expect(servedAttachmentMime('t/a.bin')).toBe('application/octet-stream');
  });

  test('kinds', () => {
    expect(attachmentKindOf('a.xlsx')).toBe('download');
    expect(attachmentKindOf('a.csv')).toBe('text');
    expect(attachmentKindOf('a.png')).toBe('image');
    expect(attachmentKindOf('a.exe')).toBeNull();
  });
});
