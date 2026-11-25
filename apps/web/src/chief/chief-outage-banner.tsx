import { CircleAlert, Info, WifiOff } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../components/ui/button.js';
import type { ChiefContent } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';

export const BANNER_CLS =
  'mx-auto mb-2 flex w-[calc(100%-2rem)] max-w-chat flex-none items-start gap-2.5 rounded-(--radius-card) bg-card px-3 py-2.5 text-meta leading-5 text-(--text-secondary) inset-ring-1 inset-ring-border';
const LINK_BTN_CLS =
  'h-auto cursor-pointer border-none bg-transparent p-0 text-meta font-normal text-(--text-secondary) underline-offset-2 hover:bg-transparent hover:text-(--foreground) hover:underline dark:hover:bg-transparent';

function outageWhy(
  outage: NonNullable<ChiefContent['outage']>,
  t: ReturnType<typeof useI18n>['t'],
): string {
  const model = outage.model;
  switch (outage.reason) {
    case 'quota':
      return model == null
        ? t('Coordinator 用的模型额度已用完')
        : t('Coordinator 用的模型 {model} 额度已用完', { model });
    case 'capacity':
      return model == null
        ? t('Coordinator 用的模型暂时过载')
        : t('Coordinator 用的模型 {model} 暂时过载', { model });
    case 'subscription':
      return model == null
        ? t('Coordinator 使用的订阅已过期或未授权')
        : t('Coordinator 用的模型 {model} 订阅已过期或未授权', { model });
    case 'runner-offline':
      return t('运行 Coordinator 的执行机当前离线');
  }
}

export function ChiefOutageBanner({
  outage,
  onSettings,
  className,
}: {
  outage: NonNullable<ChiefContent['outage']>;
  onSettings?: (() => void) | undefined;
  className?: string | undefined;
}) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const why = outageWhy(outage, t);
  const retryAt = outage.retryAt != null ? new Date(outage.retryAt) : null;
  const when =
    outage.reason === 'subscription' || outage.reason === 'runner-offline'
      ? t('恢复后会自动继续')
      : retryAt !== null
        ? t('{time} 会自动再试', {
            time: new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'zh-CN', {
              ...(retryAt.toDateString() === new Date().toDateString()
                ? {}
                : { month: 'short', day: 'numeric' }),
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            }).format(retryAt),
          })
        : t('恢复时间还不确定');
  return (
    <div
      role="status"
      data-testid="chief-outage"
      className={`${className ?? BANNER_CLS} ${open ? 'max-sm:flex-wrap' : 'max-sm:items-center'}`}
    >
      <CircleAlert aria-hidden="true" className="mt-0.5 size-5.5 flex-none text-(--card-button)" />
      <span className={`min-w-0 flex-1 ${open ? 'max-sm:basis-full' : ''}`}>
        <b className="block text-ui font-semibold text-(--foreground)">
          {t('Coordinator 暂时不可用')}
        </b>
        <span className={`block ${open ? '' : 'max-sm:hidden'}`}>
          {t('{why}，{when}。任务照常运行；你的消息已保存，恢复后按顺序处理。', { why, when })}
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
        {onSettings != null && (
          <Button size="sm" className="cursor-pointer" onClick={onSettings}>
            {t('给 Coordinator 换模型')}
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
    <div role="status" data-testid="chief-fallback-banner" className={`${BANNER_CLS} items-center`}>
      <Info aria-hidden="true" className="size-5.5 flex-none text-icon" />
      <span className="min-w-0 flex-1">
        {t('Coordinator 的主模型暂时不可用，本次改用备用模型 {model} 回复，判断可能不够准确。', {
          model,
        })}
      </span>
      {onSettings != null && (
        <Button variant="outline" size="sm" className="flex-none px-3" onClick={onSettings}>
          {t('换模型')}
        </Button>
      )}
    </div>
  );
}

export function ChiefConnectionBanner() {
  const { t } = useI18n();
  return (
    <div role="status" data-testid="connection-lost" className={`${BANNER_CLS} items-center`}>
      <WifiOff aria-hidden="true" className="size-5.5 flex-none text-(--card-button)" />
      <span className="min-w-0 flex-1">
        <b className="block text-ui font-semibold text-(--foreground)">
          {t('连接断开，正在重连…')}
        </b>
        <span className="block">{t('恢复连接前，新消息可能发不出去。')}</span>
      </span>
    </div>
  );
}
