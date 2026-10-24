import { StrictMode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { applyDensity, readStoredDensity } from './density.js';
import { applyLocaleLang, readStoredLocale } from './i18n/locale.js';
import { safeLocalStorage } from './safe-storage.js';
import { applyTheme, readStoredTheme } from './theme.js';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/motion.css';
import './styles/app.css';

// #1091：boot 的 storage 获取走安全缝——裸 `localStorage` 实参在 Storage
// 不可用环境（sandbox iframe / ITP / 隐私模式）会先于任何函数体抛
// SecurityError，整个模块中止，render 永不执行（白屏）。null 走两个 reader
// 的既有默认值回落。
const bootStorage = safeLocalStorage();
applyTheme(readStoredTheme(bootStorage), bootStorage);
applyDensity(readStoredDensity(bootStorage), bootStorage);
// <html lang> before first paint, exactly like the theme (issue #74)
applyLocaleLang(readStoredLocale(bootStorage));

const container = document.getElementById('root');
if (container == null) {
  throw new Error('#root missing in index.html');
}

flushSync(() => {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    document.getElementById('boot')?.remove();
  });
});
