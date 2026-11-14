export function brandFiles(): [path: string, content: string][];
export const APP_ICON: string;
export const ICNS_SLOTS: [type: string, px: number][];
export const WEB_ICONS: {
  path: string;
  px: number;
  rendition: 'Default' | 'Dark';
  shape: 'any' | 'bleed';
}[];
