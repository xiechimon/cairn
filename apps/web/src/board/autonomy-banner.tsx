import type { AutonomyPauseSource, AutonomyPauseWaitsFor, TeamRecord } from '@cairn/shared';
import { CirclePause, CirclePlay } from 'lucide-react';
import { useState } from 'react';
import { useApiMutations, useTeamAutonomy } from '../api/hooks.js';
import { NoticeBanner, withCodeSpans } from '../components/notice-banner.js';
import { Button } from '../components/ui/button.js';
import { toastError } from '../components/ui/toaster.js';
import { useI18n } from '../i18n/provider.js';
import { safeLocalStorage, safeSetItem } from '../safe-storage.js';

export type AutonomyNotice =
  | {
      kind: 'paused';
      waitsFor: AutonomyPauseWaitsFor | null;
      manual: boolean;
      multipleRepos?: true;
      fallbackSource?: AutonomyPauseSource;
    }
  | { kind: 'resumed'; id: string; repo: string };

const SEEN_KEY = 'cairn.autonomy-resume-seen';

export function autonomyNotice(
  team: Pick<TeamRecord, 'autonomyPauses' | 'autonomyAutoResume'> | null | undefined,
  seenResumeId: string | null,
): AutonomyNotice | null {
  const pauses = team?.autonomyPauses ?? [];
  if (pauses.length > 0) {
    if (pauses.some((pause) => pause.source === 'settings'))
      return { kind: 'paused', waitsFor: null, manual: true };
    const blocking = pauses.find((pause) => pause.waitsFor === null);
    if (blocking !== undefined)
      return { kind: 'paused', waitsFor: null, manual: false, fallbackSource: blocking.source };
    const repos = new Set(pauses.map((pause) => pause.waitsFor?.repo.toLowerCase()));
    if (repos.size > 1)
      return { kind: 'paused', waitsFor: null, manual: false, multipleRepos: true };
    return { kind: 'paused', waitsFor: pauses.at(-1)?.waitsFor ?? null, manual: false };
  }
  const resumed = team?.autonomyAutoResume;
  if (resumed == null || resumed.id === seenResumeId) return null;
  return { kind: 'resumed', id: resumed.id, repo: resumed.repo };
}

export function useAutonomyNotice(live: boolean): {
  notice: AutonomyNotice | null;
  dismiss: (id: string) => void;
} {
  const teamQ = useTeamAutonomy(live);
  const [seen, setSeen] = useState(() => safeLocalStorage()?.getItem(SEEN_KEY) ?? null);
  return {
    notice: autonomyNotice(teamQ.data, seen),
    dismiss: (id) => {
      setSeen(id);
      safeSetItem(SEEN_KEY, id);
    },
  };
}

export function AutonomyBanner({
  notice,
  teamId,
  onDismiss,
}: {
  notice: AutonomyNotice;
  teamId: string | undefined;
  onDismiss: (id: string) => void;
}) {
  const { t } = useI18n();
  const { patchTeam } = useApiMutations(teamId);
  if (notice.kind === 'resumed')
    return (
      <NoticeBanner
        data-testid="autonomy-banner"
        data-autonomy="resumed"
        role="status"
        aria-label={t('自治合并')}
        tone="info"
        icon={CirclePlay}
        title={t('自治合并已恢复：{repo} 的主分支检查已通过', { repo: notice.repo })}
        actions={
          <Button size="sm" variant="ghost" onClick={() => onDismiss(notice.id)}>
            {t('知道了')}
          </Button>
        }
      />
    );
  const body =
    notice.waitsFor !== null
      ? withCodeSpans(
          t('{repo} 的主分支检查在 `{sha}` 失败。检查重新通过后自动恢复。', {
            repo: notice.waitsFor.repo,
            sha: notice.waitsFor.failedSha.slice(0, 7),
          }),
        )
      : notice.multipleRepos
        ? t('多个仓库的主分支检查未通过。所有相关检查均通过后自动恢复。')
        : notice.manual
          ? t('自治合并已手动暂停，须手动恢复。')
          : notice.fallbackSource === 'unjudged-landing'
            ? t('合并前未完成审核，须手动恢复自治合并。')
            : notice.fallbackSource === 'main-red'
              ? t('主分支检查未通过，须手动恢复自治合并。')
              : t('升级前的暂停仍然有效，须手动恢复自治合并。');
  return (
    <NoticeBanner
      data-testid="autonomy-banner"
      data-autonomy="paused"
      role="status"
      aria-label={t('自治合并')}
      tone="waiting"
      icon={CirclePause}
      title={t('自治合并已暂停')}
      body={body}
      actions={
        <Button
          size="sm"
          variant="outline"
          disabled={patchTeam.isPending}
          onClick={() =>
            patchTeam.mutate(
              { autonomyPaused: false },
              { onError: (error) => toastError(t('未能恢复自治合并，请重试。'), error) },
            )
          }
        >
          {t('现在恢复')}
        </Button>
      }
    />
  );
}
