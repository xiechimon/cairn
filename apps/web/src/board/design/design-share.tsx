import { designSharePath } from '@cairn/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { Button } from '../../components/ui/button.js';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover.js';
import { toastError, toastSuccess } from '../../components/ui/toaster.js';
import { useI18n } from '../../i18n/provider.js';
import { copyTextWithFeedback } from '../../lib/clipboard.js';
import { settingsHref } from '../../settings/settings-href.js';
import { downloadPageHtml } from './design-export.js';

export interface ShareControl {
  busy: boolean;
  create: (onError: (error: unknown) => void) => void;
  stop: (onError: (error: unknown) => void) => void;
}

export function SharePopover({
  fileName,
  html,
  shareOrigin,
  shareToken,
  readOnly,
  control,
}: {
  fileName: string;
  html: string | undefined;
  shareOrigin: string | null;
  shareToken: string | null;
  readOnly: boolean;
  control: ShareControl;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const link =
    shareOrigin !== null && shareToken !== null
      ? `${shareOrigin}${designSharePath(shareToken)}`
      : null;
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next && shareOrigin === null && html !== undefined) downloadPageHtml(html, fileName);
        setOpen(next);
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            data-testid="design-share"
            disabled={html === undefined}
            className="flex-none text-content-secondary hover:text-foreground"
          />
        }
      >
        {t('分享')}
      </PopoverTrigger>
      <PopoverContent align="end" data-testid="design-share-popover" className="w-80 p-3">
        {shareOrigin === null ? (
          <div data-testid="design-share-no-relay" className="flex flex-col gap-2">
            <p className="m-0 text-ui text-foreground">
              {t('已下载 {name}，可以直接发给别人打开。', { name: fileName })}
            </p>
            <p className="m-0 text-meta text-content-secondary">
              {t('生成链接需要先配置中继（远程访问）')}
            </p>
            <Button
              variant="outline"
              size="sm"
              data-testid="design-share-relay-settings"
              className="self-start"
              render={<Link to={settingsHref('remote')} onClick={() => setOpen(false)} />}
            >
              {t('去设置远程访问')}
            </Button>
          </div>
        ) : link !== null ? (
          <div data-testid="design-share-live" className="flex flex-col gap-2">
            <p className="m-0 text-meta text-content-secondary">
              {t('获得链接的人都能查看这个页面的当前版本。')}
            </p>
            <div className="flex items-center gap-2 rounded-(--radius-control) bg-muted px-3 py-2">
              <code
                data-testid="design-share-url"
                className="min-w-0 flex-1 break-all font-mono text-meta text-foreground"
              >
                {link}
              </code>
              <Button
                variant="outline"
                size="xs"
                data-testid="design-share-copy"
                className="shrink-0"
                onClick={() =>
                  copyTextWithFeedback(
                    link,
                    () => toastSuccess(t('已复制')),
                    (error) => toastError(t('未能复制'), error),
                  )
                }
              >
                {t('复制')}
              </Button>
            </div>
            {!readOnly && (
              <Button
                variant="ghost"
                size="sm"
                data-testid="design-share-stop"
                disabled={control.busy}
                className="self-start text-content-secondary"
                onClick={() => control.stop((error) => toastError(t('未能停止分享'), error))}
              >
                {t('停止分享')}
              </Button>
            )}
          </div>
        ) : (
          <div data-testid="design-share-off" className="flex flex-col gap-2">
            <p className="m-0 text-ui text-foreground">
              {readOnly
                ? t('任务已归档，不能再生成分享链接。')
                : t('生成一个公开链接，获得链接的人都能查看这个页面的当前版本。')}
            </p>
            {!readOnly && (
              <Button
                size="sm"
                data-testid="design-share-create"
                disabled={control.busy}
                className="self-start"
                onClick={() => control.create((error) => toastError(t('链接未能生成'), error))}
              >
                {t('生成链接')}
              </Button>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
