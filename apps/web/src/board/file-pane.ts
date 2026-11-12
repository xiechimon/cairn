import { isImageAttachmentExt } from '@cairn/shared';
import { createContext } from 'react';
import { attachmentIdFromKey } from '../detail/attachment-chip.js';

export const FILE_PARAM = 'file';
export const FILE_NAME_PARAM = 'fileName';

export interface FileTarget {
  name: string;
  key: string;
}

export type FilePreviewKind = 'text' | 'image' | 'pdf' | 'other';

const TEXT_EXTS = new Set([
  'md',
  'txt',
  'markdown',
  'rst',
  'adoc',
  'json',
  'yaml',
  'yml',
  'toml',
  'xml',
  'csv',
  'tsv',
  'html',
  'htm',
  'css',
  'scss',
  'less',
  'js',
  'jsx',
  'ts',
  'tsx',
  'mjs',
  'cjs',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'kt',
  'swift',
  'm',
  'mm',
  'c',
  'h',
  'cpp',
  'hpp',
  'cs',
  'sh',
  'bash',
  'zsh',
  'ps1',
  'sql',
  'graphql',
  'proto',
  'log',
  'diff',
  'patch',
]);

export const OpenFileContext = createContext<((target: FileTarget) => void) | undefined>(undefined);

function extOf(key: string): string {
  const dot = key.lastIndexOf('.');
  return dot < 0 ? '' : key.slice(dot + 1).toLowerCase();
}

export function filePreviewKind(key: string): FilePreviewKind {
  const ext = extOf(key);
  if (isImageAttachmentExt(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  return TEXT_EXTS.has(ext) ? 'text' : 'other';
}

export function isMarkdownFile(key: string): boolean {
  const ext = extOf(key);
  return ext === 'md' || ext === 'markdown';
}

export function attachmentUrl(key: string): string {
  return `/api/attachments/${encodeURIComponent(attachmentIdFromKey(key))}`;
}

export function fileTargetOf(params: URLSearchParams): FileTarget | null {
  const key = params.get(FILE_PARAM);
  if (key === null || key === '') return null;
  return { key, name: params.get(FILE_NAME_PARAM) ?? attachmentIdFromKey(key) };
}

export function withoutFileTarget(params: URLSearchParams): URLSearchParams {
  params.delete(FILE_PARAM);
  params.delete(FILE_NAME_PARAM);
  return params;
}
