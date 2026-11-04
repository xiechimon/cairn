import type { BackupNotice } from '@cairn/shared';
import { CircleAlert, CircleX } from 'lucide-react';
import { formatBackupWarning } from '../backup-warning.js';
import { NoticeBanner, withCodeSpans } from '../components/notice-banner.js';
import { useI18n } from '../i18n/provider.js';

const BACKUP_TITLE: Record<BackupNotice['kind'], string> = {
  stale: '数据库备份已停止',
  failing: '数据库备份失败',
  unreadable: '无法确认数据库备份状态',
};

export function BackupBanner({ notice }: { notice: BackupNotice }) {
  const { t } = useI18n();
  return (
    <NoticeBanner
      data-testid="backup-warning"
      data-backup={notice.kind}
      role="status"
      aria-label={t('服务器数据库备份')}
      tone={notice.kind === 'failing' ? 'danger' : 'warning'}
      icon={notice.kind === 'failing' ? CircleX : CircleAlert}
      title={t(BACKUP_TITLE[notice.kind])}
      body={withCodeSpans(formatBackupWarning(notice, t))}
    />
  );
}
