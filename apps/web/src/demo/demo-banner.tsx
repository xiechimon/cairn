import { useI18n } from '../i18n/provider.js';

const SITE_URL = 'https://cairn.xmon.me';

export function DemoBanner() {
  const { t } = useI18n();
  return (
    <div
      data-testid="demo-banner"
      className="flex h-9 flex-none items-center gap-3 overflow-hidden border-b border-border bg-background px-4 text-ui whitespace-nowrap"
    >
      <span className="flex-none font-medium text-foreground">{t('演示数据')}</span>
      <span className="hidden min-w-0 truncate text-(--text-secondary) sm:inline">
        {t('只读演示，改动不会被保存。')}
      </span>
      <span className="ml-auto flex flex-none items-center gap-3">
        <a className="text-(--text-secondary) underline-offset-2 hover:underline" href={SITE_URL}>
          {t('官网')}
        </a>
        <a
          className="text-(--text-secondary) underline-offset-2 hover:underline"
          href={`${SITE_URL}/#showcase`}
        >
          {t('闭环录像')}
        </a>
      </span>
    </div>
  );
}
