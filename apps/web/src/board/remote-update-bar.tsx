import type { RemoteVersionState } from '@cairn/shared';
import { cn } from 'cn';
import { useEffect, useState } from 'react';
import { Button } from '../components/ui/button.js';
import { desktopUpdates } from '../desktop-shell.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';

export function formatServerVersion(
  version: string | null,
  commit: string | null,
  t: TFunc,
): string {
  const shortCommit = commit === null ? null : commit.slice(0, 7);
  if (version === null) {
    return shortCommit === null ? t('未知版本') : t('开发版 · {commit}', { commit: shortCommit });
  }
  return shortCommit === null ? version : `${version} · ${shortCommit}`;
}

export interface RemoteUpdatePresentation {
  message: string;
  tone: 'quiet' | 'error';
  actionLabel: string | null;
}

export function remoteUpdatePresentation(
  state: RemoteVersionState,
  t: TFunc,
): RemoteUpdatePresentation | null {
  const target = state.targetVersion ?? state.appVersion;
  if (state.phase === 'updating') {
    if (state.updaterState === 'waiting-idle') {
      return {
        message: t('远程主机正忙，空闲后会自动更新到 {version}。', { version: target }),
        tone: 'quiet',
        actionLabel: null,
      };
    }
    if (state.updaterState === 'downloading' && state.percent !== null) {
      return {
        message: t('正在把远程主机更新到 {version}（{percent}%）。', {
          version: target,
          percent: Math.round(state.percent),
        }),
        tone: 'quiet',
        actionLabel: null,
      };
    }
    return {
      message: t('正在把远程主机更新到 {version}。', { version: target }),
      tone: 'quiet',
      actionLabel: null,
    };
  }
  if (state.phase === 'restarting' || state.phase === 'reloading') {
    return { message: t('远程主机正在重启。'), tone: 'quiet', actionLabel: null };
  }
  if (state.phase === 'old-server') {
    return {
      message: t('这台远程主机版本较旧，无法自动更新，请在该电脑上更新 Cairn。'),
      tone: 'error',
      actionLabel: t('重新检查'),
    };
  }
  if (state.phase === 'unsupported') {
    return {
      message: t('这台远程主机无法自动更新，请在该电脑上手动更新 Cairn。'),
      tone: 'error',
      actionLabel: t('重新检查'),
    };
  }
  if (state.phase === 'failed') {
    if (state.reason === 'offline') {
      return {
        message: t('远程主机无法连接更新服务，请稍后重试。'),
        tone: 'error',
        actionLabel: t('重试'),
      };
    }
    if (state.reason === 'no-release') {
      return {
        message: t('远程主机尚无可用的新版本。'),
        tone: 'error',
        actionLabel: t('重新检查'),
      };
    }
    return {
      message: t('远程主机未能完成更新。'),
      tone: 'error',
      actionLabel: t('重试'),
    };
  }
  return null;
}

export function RemoteUpdateBar() {
  const { t } = useI18n();
  const [bridge] = useState(desktopUpdates);
  const [state, setState] = useState<RemoteVersionState | null>(null);

  useEffect(() => {
    document.querySelector('[data-cairn-remote-fallback]')?.remove();
    if (
      bridge === null ||
      typeof bridge.remoteState !== 'function' ||
      typeof bridge.subscribeRemote !== 'function'
    ) {
      return;
    }
    let active = true;
    void bridge.remoteState().then((initial) => {
      if (active) setState(initial);
    });
    const unsubscribe = bridge.subscribeRemote((next) => setState(next));
    return () => {
      active = false;
      unsubscribe();
    };
  }, [bridge]);

  if (bridge === null || state === null) return null;
  const presentation = remoteUpdatePresentation(state, t);
  if (presentation === null) return null;

  return (
    <div
      data-testid="remote-update-bar"
      data-tone={presentation.tone}
      role="status"
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 flex justify-center border-t border-border px-4 py-2 text-meta',
        presentation.tone === 'error'
          ? 'bg-(--tint-fail-soft) text-tint-fail-ink'
          : 'bg-popover text-content-secondary',
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="truncate tabular-nums">{presentation.message}</span>
        {presentation.actionLabel !== null && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 flex-none px-2 text-caption pointer-coarse:h-11 pointer-coarse:px-4"
            data-testid="remote-update-action"
            onClick={() => void bridge.retryRemote?.()}
          >
            {presentation.actionLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
