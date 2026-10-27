import { useState } from 'react';
import { Button } from '../components/ui/button.js';
import type { ChiefContent } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';

const BANNER_CLS =
  'mx-auto mb-2 flex w-[calc(100%-2rem)] max-w-182 flex-none items-start gap-2.5 rounded-(--radius-card) bg-card px-3 py-2.5 text-meta leading-5 text-(--text-secondary)';
const LINK_BTN_CLS =
  'h-auto cursor-pointer border-none bg-transparent p-0 text-meta font-normal text-(--text-secondary) underline-offset-2 hover:bg-transparent hover:text-(--foreground) hover:underline dark:hover:bg-transparent';

function retryText(retryAt: number, locale: string): string {
  const at = new Date(retryAt);
  const sameDay = at.toDateString() === new Date().toDateString();
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'zh-CN', {
    ...(sameDay ? {} : { month: 'short', day: 'numeric' }),
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
}

export function ChiefOutageBanner({
  outage,
  onSettings,
  onNewTask,
}: {
  outage: NonNullable<ChiefContent['outage']>;
  onSettings?: (() => void) | undefined;
  onNewTask?: (() => void) | undefined;
}) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const model = outage.model ?? t('总管的模型');
  const why =
    outage.reason === 'quota'
      ? t('总管用的模型 {model} 额度已用完', { model })
      : t('总管用的模型 {model} 暂时过载', { model });
  const when =
    outage.retryAt != null
      ? t('{time} 会自动再试', { time: retryText(outage.retryAt, locale) })
      : t('恢复时间还不确定');
  return (
    <div
      role="status"
      data-testid="chief-outage"
      className={`${BANNER_CLS} shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--badge-attention)_45%,transparent)] ${open ? 'max-sm:flex-wrap' : 'max-sm:items-center'}`}
    >
      <span className={`min-w-0 flex-1 ${open ? 'max-sm:basis-full' : ''}`}>
        <b className="flex items-center gap-2 text-ui font-medium text-(--foreground)">
          <span
            aria-hidden="true"
            className="size-2 flex-none rounded-full bg-(--badge-attention)"
          />
          {t('总管暂时不可用')}
        </b>
        <span className={`block ${open ? '' : 'max-sm:hidden'}`}>
          {t('{why}，{when}。任务照常在跑；你说的话先存下，恢复后按顺序处理。', { why, when })}
        </span>
      </span>
      <span className="ml-auto flex flex-none items-center gap-3 self-center">
        <Button
          variant="ghost"
          className={`${LINK_BTN_CLS} sm:hidden`}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? t('收起') : t('详情')}
        </Button>
        {onNewTask != null && (
          <Button
            variant="ghost"
            className={`${LINK_BTN_CLS} ${open ? '' : 'max-sm:hidden'}`}
            onClick={onNewTask}
          >
            {t('直接建任务')}
          </Button>
        )}
        {onSettings != null && (
          <Button size="sm" className="cursor-pointer" onClick={onSettings}>
            {t('给总管换模型')}
          </Button>
        )}
      </span>
    </div>
  );
}

export function ChiefFallbackBanner({
  model,
  onSettings,
}: {
  model: string;
  onSettings?: (() => void) | undefined;
}) {
  const { t } = useI18n();
  return (
    <div
      role="status"
      data-testid="chief-fallback-banner"
      className={`${BANNER_CLS} items-center shadow-[inset_0_0_0_1px_var(--border)]`}
    >
      <span className="min-w-0 flex-1">
        {t('总管的主模型暂时用不了，这次改用备用模型 {model} 回复，判断可能没那么准。', {
          model,
        })}
      </span>
      {onSettings != null && (
        <Button variant="ghost" className={`${LINK_BTN_CLS} flex-none`} onClick={onSettings}>
          {t('换模型')}
        </Button>
      )}
    </div>
  );
}
