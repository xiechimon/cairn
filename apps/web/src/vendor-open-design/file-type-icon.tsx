// SPDX-License-Identifier: Apache-2.0. Modified by Cairn from nexu-io/open-design@07258801 apps/web/src/components/FileTypeIcon.tsx
import { cn } from 'cn';

export type FileTypeIconName =
  | 'audio'
  | 'code'
  | 'excel'
  | 'markdown'
  | 'pdf'
  | 'ppt'
  | 'word'
  | 'zip';

function extensionOf(name: string): string {
  return /\.([a-z0-9_]{1,10})$/i.exec(name)?.[1]?.toLowerCase() ?? '';
}

const ICON_BY_EXTENSION = new Map<string, FileTypeIconName>([
  ...(['csv', 'numbers', 'tsv', 'xls', 'xlsm', 'xlsx'] as const).map(
    (ext) => [ext, 'excel'] as const,
  ),
  ...(['doc', 'docx', 'odt', 'pages', 'rtf'] as const).map((ext) => [ext, 'word'] as const),
  ...(['key', 'odp', 'ppt', 'pptx'] as const).map((ext) => [ext, 'ppt'] as const),
  ...(['pdf'] as const).map((ext) => [ext, 'pdf'] as const),
  ...(['markdown', 'md', 'mdx'] as const).map((ext) => [ext, 'markdown'] as const),
  ...(
    [
      'astro',
      'bash',
      'c',
      'cc',
      'cjs',
      'cpp',
      'cs',
      'css',
      'dart',
      'diff',
      'fish',
      'go',
      'gradle',
      'h',
      'hpp',
      'htm',
      'html',
      'ini',
      'ipynb',
      'java',
      'js',
      'json',
      'json5',
      'jsx',
      'kt',
      'kts',
      'less',
      'lua',
      'mjs',
      'patch',
      'php',
      'pl',
      'ps1',
      'py',
      'r',
      'rb',
      'rs',
      'sass',
      'scala',
      'scss',
      'sh',
      'sql',
      'svelte',
      'swift',
      'toml',
      'ts',
      'tsx',
      'vue',
      'xml',
      'yaml',
      'yml',
      'zsh',
    ] as const
  ).map((ext) => [ext, 'code'] as const),
  ...(['7z', 'bz2', 'gz', 'rar', 'tar', 'tgz', 'xz', 'zip', 'zst'] as const).map(
    (ext) => [ext, 'zip'] as const,
  ),
  ...(
    [
      'aac',
      'aif',
      'aiff',
      'flac',
      'm4a',
      'mid',
      'midi',
      'mp3',
      'oga',
      'ogg',
      'opus',
      'wav',
      'wma',
    ] as const
  ).map((ext) => [ext, 'audio'] as const),
]);

export function resolveFileTypeIcon(name: string): FileTypeIconName | null {
  return ICON_BY_EXTENSION.get(extensionOf(name)) ?? null;
}

const INK: Record<FileTypeIconName, string> = {
  excel: 'text-(--file-excel)',
  word: 'text-(--file-word)',
  ppt: 'text-(--file-ppt)',
  pdf: 'text-(--file-pdf)',
  markdown: 'text-icon',
  code: 'text-icon',
  zip: 'text-icon',
  audio: 'text-icon',
};

const OFFICE_FRAME =
  'M17 2.99973H21C21.5523 2.99973 22 3.44745 22 3.99973V19.9998C22 20.5521 21.5523 20.9998 21 20.9998H17V2.99973ZM2.85858 2.87708L15.4293 1.08126C15.7027 1.04221 15.9559 1.23216 15.995 1.50553C15.9983 1.52895 16 1.55258 16 1.57624V22.4233C16 22.6994 15.7761 22.9233 15.5 22.9233C15.4763 22.9233 15.4527 22.9216 15.4293 22.9182L2.85858 21.1224C2.36593 21.052 2 20.6301 2 20.1325V3.86703C2 3.36938 2.36593 2.94746 2.85858 2.87708Z';

const PATHS: Record<FileTypeIconName, string> = {
  excel: `${OFFICE_FRAME}M10.2 11.9998L13 7.99973H10.6L9 10.2855L7.39999 7.99973H5L7.8 11.9998L5 15.9998H7.39999L9 13.7141L10.6 15.9998H13L10.2 11.9998Z`,
  word: `${OFFICE_FRAME}M11 7.99973V12.9888L9 10.9998L7.01083 12.9998L7 7.99973H5V15.9998H7L9 13.9998L11 15.9998H13V7.99973H11Z`,
  ppt: `${OFFICE_FRAME}M5 7.99973V15.9998H7V13.9998H13V7.99973H5ZM7 9.99974H11V11.9998H7V9.99974Z`,
  pdf: 'M3.9985 2C3.44749 2 3 2.44405 3 2.9918V21.0082C3 21.5447 3.44476 22 3.9934 22H20.0066C20.5551 22 21 21.5489 21 20.9925L20.9997 7L16 2H3.9985ZM10.5 7.5H12.5C12.5 9.98994 14.6436 12.6604 17.3162 13.5513L16.8586 15.49C13.7234 15.0421 10.4821 16.3804 7.5547 18.3321L6.3753 16.7191C7.46149 15.8502 8.50293 14.3757 9.27499 12.6534C10.0443 10.9373 10.5 9.07749 10.5 7.5ZM11.1 13.4716C11.3673 12.8752 11.6043 12.2563 11.8037 11.6285C12.2754 12.3531 12.8553 13.0182 13.5102 13.5953C12.5284 13.7711 11.5666 14.0596 10.6353 14.4276C10.8 14.1143 10.9551 13.7948 11.1 13.4716Z',
  markdown:
    'M3 3H21C21.5523 3 22 3.44772 22 4V20C22 20.5523 21.5523 21 21 21H3C2.44772 21 2 20.5523 2 20V4C2 3.44772 2.44772 3 3 3ZM7 15.5V11.5L9 13.5L11 11.5V15.5H13V8.5H11L9 10.5L7 8.5H5V15.5H7ZM18 12.5V8.5H16V12.5H14L17 15.5L20 12.5H18Z',
  code: 'M3 3H21C21.5523 3 22 3.44772 22 4V20C22 20.5523 21.5523 21 21 21H3C2.44772 21 2 20.5523 2 20V4C2 3.44772 2.44772 3 3 3ZM16.4645 15.5355L20 12L16.4645 8.46447L15.0503 9.87868L17.1716 12L15.0503 14.1213L16.4645 15.5355ZM6.82843 12L8.94975 9.87868L7.53553 8.46447L4 12L7.53553 15.5355L8.94975 14.1213L6.82843 12ZM11.2443 17L14.884 7H12.7557L9.11597 17H11.2443Z',
  zip: 'M10 2V4H12V2H20.0066C20.5551 2 21 2.44405 21 2.9918V21.0082C21 21.5447 20.5552 22 20.0066 22H3.9934C3.44495 22 3 21.556 3 21.0082V2.9918C3 2.45531 3.44476 2 3.9934 2H10ZM12 4V6H14V4H12ZM10 6V8H12V6H10ZM12 8V10H14V8H12ZM10 10V12H12V10H10ZM12 12V14H10V17H14V12H12Z',
  audio:
    'M2 3.9934C2 3.44476 2.45531 3 2.9918 3H21.0082C21.556 3 22 3.44495 22 3.9934V20.0066C22 20.5552 21.5447 21 21.0082 21H2.9918C2.44405 21 2 20.5551 2 20.0066V3.9934ZM12 12.1707C11.6872 12.0602 11.3506 12 11 12C9.34315 12 8 13.3431 8 15C8 16.6569 9.34315 18 11 18C12.6569 18 14 16.6569 14 15V8H17V6H12V12.1707Z',
};

export function FileTypeIcon({ name, className }: { name: FileTypeIconName; className?: string }) {
  return (
    <svg
      aria-hidden
      data-file-icon={name}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('flex-none', INK[name], className)}
    >
      <path d={PATHS[name]} fill="currentColor" />
    </svg>
  );
}
