export const PANEL_WIDTH_DEFAULT = 420;
export const PANEL_WIDTH_MIN = 360;
export const PANEL_WIDTH_STEP = 16;
export const PANEL_WIDTH_STORAGE_KEY = 'cairn.side-panel-width';

const MAX_SHARE = 0.6;

export function panelWidthMax(viewport: number): number {
  return Math.max(PANEL_WIDTH_MIN, Math.floor(viewport * MAX_SHARE));
}

export function clampPanelWidth(width: number, viewport: number): number {
  return Math.min(panelWidthMax(viewport), Math.max(PANEL_WIDTH_MIN, Math.round(width)));
}

export function readPanelWidth(stored: string | null, viewport: number): number {
  const parsed = stored === null || stored === '' ? Number.NaN : Number(stored);
  return Number.isFinite(parsed) ? clampPanelWidth(parsed, viewport) : PANEL_WIDTH_DEFAULT;
}
