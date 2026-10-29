import type { BackupNotice } from '@cairn/shared';
import { formatBackupWarning } from '../backup-warning.js';
import { useI18n } from '../i18n/provider.js';

export function BackupBanner({ notice }: { notice: BackupNotice }) {
  const { t } = useI18n();
  return (
    <section
      data-testid="backup-warning"
      data-backup={notice.kind}
      role="status"
      aria-label={t('服务器数据库备份')}
      className="board-notify-banner flex min-h-16 items-center rounded-2xl border-0 bg-(--secondary) px-4 py-3 [box-shadow:var(--edge-ring),var(--card-shadow)]"
    >
      <span
        aria-hidden
        className="flex size-7 flex-none items-center justify-center rounded-full bg-(--badge-attention) text-caption leading-none font-bold text-(--badge-attention-fg)"
      >
        !
      </span>
      <p className="m-0 ml-3.5 min-w-0 text-sm leading-5 font-medium text-foreground">
        {formatBackupWarning(notice, t)}
      </p>
    </section>
  );
}
