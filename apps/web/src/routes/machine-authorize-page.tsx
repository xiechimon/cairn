import type { MachineEnrollPollResponse } from '@cairn/shared';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { ApiError, api } from '../api/client.js';
import { withCodeSpans } from '../components/notice-banner.js';
import { Button } from '../components/ui/button.js';
import { Card } from '../components/ui/card.js';
import { DIALOG_TITLE_CLS } from '../components/ui/dialog-shell.js';
import { DEMO_MODE } from '../demo/demo-gate.js';
import { useI18n } from '../i18n/provider.js';
import {
  CopyCommand,
  INSTALL_COMMAND,
  startCommand,
  useRunnerServerAccess,
} from '../resources/create-machine-dialog.js';
import { MACHINES_HREF } from '../resources/hrefs.js';

type Phase = 'idle' | 'pending' | 'authorizing' | 'authorized' | 'expired';

const POLL_INTERVAL_MS = 2_000;

const DESC_CLASS = 'm-0 text-ui text-content-secondary';

export function MachineAuthorizePage() {
  const { t } = useI18n();
  const { search } = useLocation();
  const [searchParams] = useSearchParams();
  const enrollId = searchParams.get('enroll');
  const [phase, setPhase] = useState<Phase>(enrollId !== null ? 'pending' : 'idle');
  const [failed, setFailed] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [polled, setPolled] = useState(false);
  const [pollFailed, setPollFailed] = useState(false);
  const { serverUrl } = useRunnerServerAccess(phase === 'idle');
  const stopped = useRef(false);
  const retryPollRef = useRef<(() => Promise<void>) | null>(null);
  useEffect(() => {
    stopped.current = false;
    return () => {
      stopped.current = true;
    };
  }, []);

  useEffect(() => {
    if (enrollId === null || phase !== 'pending' || DEMO_MODE) {
      retryPollRef.current = null;
      return;
    }
    const tick = async () => {
      try {
        const res = await api.post<MachineEnrollPollResponse>('/api/machine/enroll/poll', {
          enrollId,
        });
        if (stopped.current) return;
        setPollFailed(false);
        if (res.status === 'pending') {
          setPolled(true);
          if (res.name) setName(res.name);
          if (res.code) setCode(res.code);
        }
        if (res.status === 'authorized') {
          if (res.name) setName(res.name);
          setPhase('authorized');
        } else if (res.status === 'expired') setPhase('expired');
      } catch {
        if (!stopped.current) setPollFailed(true);
      }
    };
    retryPollRef.current = tick;
    void tick();
    const timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      retryPollRef.current = null;
      clearInterval(timer);
    };
  }, [enrollId, phase]);

  const confirm = async (): Promise<void> => {
    if (enrollId === null || phase !== 'pending') return;
    setPhase('authorizing');
    setFailed(null);
    try {
      await api.post('/api/machine/enroll/confirm', { enrollId });
      setPhase('authorized');
    } catch (err) {
      const status = err instanceof ApiError ? err.status : null;
      if (status === 409) setPhase('authorized');
      else if (status === 404) setPhase('expired');
      else {
        setPhase('pending');
        setFailed(err instanceof Error ? err.message : String(err));
      }
    }
  };

  const backSearch = new URLSearchParams(search);
  backSearch.delete('enroll');
  const waiting = phase === 'pending' || phase === 'authorizing';

  return (
    <div className="authorize-backdrop fixed inset-0 flex items-center justify-center overflow-y-auto bg-background p-6">
      <div className="flex w-[400px] max-w-full flex-col items-center gap-4">
        <Card role="region" aria-label={t('授权执行机')} className="w-full gap-3 p-6">
          <h1 className={DIALOG_TITLE_CLS}>{t('授权执行机')}</h1>
          {phase === 'idle' &&
            (serverUrl === null ? (
              <p className={DESC_CLASS}>
                {t('先在执行机页的「添加执行机」里用 Tailscale 连通这台电脑，命令会出现在这里。')}
              </p>
            ) : (
              <>
                <p className={DESC_CLASS}>
                  {t('在要接入的电脑上依次运行这两条命令。终端会给出授权链接，打开它就能确认。')}
                </p>
                <CopyCommand command={INSTALL_COMMAND} />
                <CopyCommand command={startCommand(serverUrl)} />
              </>
            ))}
          {waiting && (
            <>
              <p className={DESC_CLASS}>{t('有一台执行机请求加入你的团队。')}</p>
              {code !== null && (
                <div className="flex items-baseline justify-between gap-3 rounded-md border border-border px-3 py-2 text-meta">
                  <span className="text-content-secondary">{t('确认码')}</span>
                  <span className="font-mono text-foreground tabular-nums">{code}</span>
                </div>
              )}
              {name !== null && (
                <>
                  <div className="flex items-baseline justify-between gap-3 rounded-md border border-border px-3 py-2 text-meta">
                    <span className="text-content-secondary">{t('执行机名称')}</span>
                    <span className="font-mono text-foreground break-all">{name}</span>
                  </div>
                  <p className="m-0 text-meta text-content-tertiary">
                    {t('名字是那台电脑自己报的。和终端里显示的一样才确认。')}
                  </p>
                </>
              )}
              <Button
                className="w-full pointer-coarse:h-11"
                disabled={!polled || phase === 'authorizing'}
                onClick={() => void confirm()}
              >
                {phase === 'authorizing'
                  ? t('正在授权…')
                  : polled
                    ? t('确认授权')
                    : t('正在连接执行机…')}
              </Button>
              {pollFailed && !polled && (
                <div className="flex items-center justify-between gap-2">
                  <p className="m-0 text-meta text-content-secondary" role="status">
                    {t('无法连接服务器，正在重试。请检查网络。')}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    data-testid="enroll-poll-retry"
                    className="shrink-0 pointer-coarse:h-11 pointer-coarse:px-3"
                    onClick={() => void retryPollRef.current?.()}
                  >
                    {t('立即重试')}
                  </Button>
                </div>
              )}
              {failed !== null && (
                <p
                  className="m-0 text-meta text-destructive [&_code]:whitespace-nowrap"
                  role="alert"
                  title={failed}
                >
                  {withCodeSpans(
                    t('授权未成功，请重试。仍然失败时，在执行机上重新运行 `cairn start`。'),
                  )}
                </p>
              )}
            </>
          )}
          {phase === 'authorized' && (
            <p className={DESC_CLASS}>
              {name !== null
                ? t('授权完成，{name} 已注册为执行机。终端会自动连接，可以关闭这一页。', {
                    name,
                  })
                : t('授权完成，执行机已注册。终端会自动连接，可以关闭这一页。')}
            </p>
          )}
          {phase === 'expired' && (
            <p className={`${DESC_CLASS} [&_code]:whitespace-nowrap`}>
              {withCodeSpans(t('授权链接已过期。在执行机上重新运行 `cairn start` 获取新链接。'))}
            </p>
          )}
        </Card>
        <Link
          className="inline-flex min-h-6 items-center text-meta pointer-coarse:min-h-11"
          to={{ pathname: MACHINES_HREF, search: backSearch.toString() }}
        >
          {t('← 返回执行机')}
        </Link>
      </div>
    </div>
  );
}
