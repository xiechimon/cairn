import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from '../components/ui/toaster.js';
import { TooltipProvider } from '../components/ui/tooltip.js';
import { I18nProvider } from '../i18n/provider.js';
import { trackPointerFocus } from '../pointer-focus.js';
import { safeLocalStorage } from '../safe-storage.js';
import { resolveStoredTheme } from '../theme.js';
import '../styles/fonts.css';
import '../styles/motion.css';
import '../styles/app.css';
import { Gallery, GalleryOnly } from './gallery.js';
import { readGalleryParams } from './gallery-params.js';

trackPointerFocus();
const params = readGalleryParams(window.location.search);
const theme = params.theme ?? resolveStoredTheme(safeLocalStorage());
document.documentElement.classList.toggle('light', theme === 'light');

const container = document.getElementById('root');
if (container == null) {
  throw new Error('#root missing in design.html');
}

createRoot(container).render(
  <StrictMode>
    <I18nProvider initialLocale="en">
      <TooltipProvider>
        {params.only == null ? (
          <Gallery />
        ) : (
          <GalleryOnly id={params.only} theme={theme} width={params.width} />
        )}
      </TooltipProvider>
      <Toaster expand visibleToasts={4} />
    </I18nProvider>
  </StrictMode>,
);
