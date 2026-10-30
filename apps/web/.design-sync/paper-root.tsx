import { type ReactNode, useLayoutEffect } from 'react';
import { I18nProvider } from '../src/i18n/provider.js';
import type { Locale } from '../src/i18n/locale.js';

document.documentElement.classList.add('light');

export function PaperRoot({
  children,
  theme = 'light',
  locale = 'zh',
}: {
  children?: ReactNode;
  theme?: 'light' | 'dark';
  locale?: Locale;
}) {
  useLayoutEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light');
  }, [theme]);
  return (
    <I18nProvider initialLocale={locale}>
      <div className={`${theme === 'light' ? 'light ' : ''}bg-background text-foreground font-sans antialiased`} style={{ padding: 16, minHeight: '100%' }}>
        {children}
      </div>
    </I18nProvider>
  );
}
