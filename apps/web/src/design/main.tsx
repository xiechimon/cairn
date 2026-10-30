import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from '../components/ui/toaster.js';
import { TooltipProvider } from '../components/ui/tooltip.js';
import { I18nProvider } from '../i18n/provider.js';
import '../styles/fonts.css';
import '../styles/tokens.css';
import '../styles/motion.css';
import '../styles/app.css';
import { Gallery } from './gallery.js';

const container = document.getElementById('root');
if (container == null) {
  throw new Error('#root missing in design.html');
}

createRoot(container).render(
  <StrictMode>
    <I18nProvider initialLocale="en">
      <TooltipProvider>
        <Gallery />
      </TooltipProvider>
      <Toaster />
    </I18nProvider>
  </StrictMode>,
);
