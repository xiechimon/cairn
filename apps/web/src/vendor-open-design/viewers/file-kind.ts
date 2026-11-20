// SPDX-License-Identifier: Apache-2.0. Modified by Cairn from nexu-io/open-design@07258801 apps/daemon/src/projects.ts
import { isImageAttachmentExt } from '@cairn/shared';

export type FileViewerKind =
  | 'markdown'
  | 'text'
  | 'image'
  | 'svg'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'document'
  | 'binary';

const TEXT_EXTS = new Set([
  'txt',
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

const VIDEO_EXTS = new Set(['mp4', 'mov', 'webm']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'm4a', 'ogg']);
const DOCUMENT_EXTS = new Set(['docx', 'pptx', 'xlsx']);

export function fileExtOf(name: string): string {
  const slash = name.lastIndexOf('/');
  const dot = name.lastIndexOf('.');
  return dot <= slash ? '' : name.slice(dot + 1).toLowerCase();
}

export function kindFor(name: string): FileViewerKind {
  const ext = fileExtOf(name);
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (ext === 'svg') return 'svg';
  if (isImageAttachmentExt(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (ext === 'pdf') return 'pdf';
  if (DOCUMENT_EXTS.has(ext)) return 'document';
  if (TEXT_EXTS.has(ext)) return 'text';
  return 'binary';
}
