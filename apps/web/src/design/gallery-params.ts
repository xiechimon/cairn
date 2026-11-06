import type { GalleryTheme } from './design-doc.js';

export interface GalleryParams {
  only: string | null;
  theme: GalleryTheme | null;
  width: number | null;
}

export function readGalleryParams(search: string): GalleryParams {
  const params = new URLSearchParams(search);
  const theme = params.get('theme');
  const width = Number(params.get('w'));
  return {
    only: params.get('only') || null,
    theme: theme === 'light' || theme === 'dark' ? theme : null,
    width: Number.isInteger(width) && width > 0 ? width : null,
  };
}
