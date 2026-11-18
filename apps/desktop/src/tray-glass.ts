import { createRequire } from 'node:module';
import { join } from 'node:path';
import { app, type BrowserWindow } from 'electron';

interface LiquidGlassAddon {
  LiquidGlassNative: new () => {
    addView: (handle: Buffer, options: { cornerRadius: number }) => number;
  };
}

const PREBUILDS: Partial<Record<string, string>> = {
  arm64: 'darwin-arm64/node.napi.armv8.node',
  x64: 'darwin-x64/node.napi.node',
};

export function addLiquidGlass(window: BrowserWindow, cornerRadius: number): boolean {
  const prebuild = PREBUILDS[process.arch];
  if (prebuild === undefined) return false;
  const root = app.isPackaged
    ? join(process.resourcesPath, 'liquid-glass')
    : join(app.getAppPath(), 'node_modules', 'electron-liquid-glass', 'prebuilds');
  try {
    const addon = createRequire(import.meta.url)(join(root, prebuild)) as LiquidGlassAddon;
    const glass = new addon.LiquidGlassNative();
    return glass.addView(window.getNativeWindowHandle(), { cornerRadius }) >= 0;
  } catch (error) {
    console.error('Cairn tray: Liquid Glass did not load, using vibrancy:', error);
    return false;
  }
}
