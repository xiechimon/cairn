export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const TRAY_POPOVER_WIDTH = 320;
export const TRAY_POPOVER_GAP = 4;
export const TRAY_POPOVER_RADIUS = 16;
const EDGE = 8;
const FIRST_LIQUID_GLASS_DARWIN = 25;

export function hasLiquidGlass(platform: string, osRelease: string): boolean {
  return platform === 'darwin' && Number.parseInt(osRelease, 10) >= FIRST_LIQUID_GLASS_DARWIN;
}

export function trayPopoverBounds(icon: Box, workArea: Box, height: number): Box {
  const centred = Math.round(icon.x + icon.width / 2 - TRAY_POPOVER_WIDTH / 2);
  const x = Math.min(
    Math.max(centred, workArea.x + EDGE),
    workArea.x + workArea.width - TRAY_POPOVER_WIDTH - EDGE,
  );
  const y = Math.max(icon.y + icon.height, workArea.y) + TRAY_POPOVER_GAP;
  const room = workArea.y + workArea.height - y - EDGE;
  return { x, y, width: TRAY_POPOVER_WIDTH, height: Math.min(Math.ceil(height), room) };
}
