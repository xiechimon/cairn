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
import { isLoopbackOrigin } from '../lib/pairing-origin.js';
import { CopyCommand, INSTALL_COMMAND, startCommand } from '../resources/create-machine-dialog.js';
import { MACHINES_HREF } from '../resources/machines-page.js';

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
  const [polled, setPolled] = useState(false);
  const [pollFailed, setPollFailed] = useState(false);
  const stopped = useRef(false);
  useEffect(() => {
    stopped.current = false;
    return () => {
      stopped.current = true;
    };
  }, []);

  useEffect(() => {
    if (enrollId === null || phase !== 'pending' || DEMO_MODE) return;
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
        }
        if (res.status === 'authorized') setPhase('authorized');
        else if (res.status === 'expired') setPhase('expired');
      } catch {
        if (!stopped.current) setPollFailed(true);
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
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

  const serverOrigin = window.location.origin;
  const backSearch = new URLSearchParams(search);
  backSearch.delete('enroll');
  const waiting = phase === 'pending' || phase === 'authorizing';

  return (
    <div className="authorize-backdrop fixed inset-0 flex items-center justify-center overflow-y-auto bg-background p-6">
      <div className="flex w-[400px] max-w-full flex-col items-center gap-4">
        <Card role="region" aria-label={t('授权执行机')} className="w-full gap-3 p-6">
          <h1 className={DIALOG_TITLE_CLS}>{t('授权执行机')}</h1>
          {phase === 'idle' && (
            <>
              <p className={DESC_CLASS}>
                {t('在要接入的电脑上依次运行这两条命令。终端会给出授权链接，打开它就能确认。')}
              </p>
              <CopyCommand command={INSTALL_COMMAND} />
              <CopyCommand command={startCommand(serverOrigin)} />
              {isLoopbackOrigin(serverOrigin) && (
                <p className="m-0 text-meta text-content-tertiary">
                  {t(
                    '当前地址只适用于这台电脑。添加另一台电脑前，请用 Tailscale 地址打开 Cairn，再复制命令。',
                  )}{' '}
                  <Link
                    className="whitespace-nowrap text-foreground underline underline-offset-2"
                    to={{ pathname: '/app/settings/remote', search: backSearch.toString() }}
                  >
                    {t('远程访问')}
                  </Link>
                </p>
              )}
            </>
          )}
          {waiting && (
            <>
              <p className={DESC_CLASS}>{t('有一台执行机请求加入你的团队。')}</p>
              {name !== null && (
                <>
                  <div className="flex items-baseline justify-between gap-3 rounded-md border border-border px-3 py-2 text-meta">
                    <span className="text-content-secondary">{t('机器名')}</span>
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
                <p className="m-0 text-meta text-content-secondary" role="status">
                  {t('连不上服务器，正在重试。请检查网络。')}
                </p>
              )}
              {failed !== null && (
                <p
                  className="m-0 text-meta text-destructive [&_code]:whitespace-nowrap"
                  role="alert"
                  title={failed}
                >
                  {withCodeSpans(
                    t('授权没成功，请再试一次。还不行就在执行机上重新运行 `cairn start`。'),
                  )}
                </p>
              )}
            </>
          )}
          {phase === 'authorized' && (
            <p className={DESC_CLASS}>
              {name !== null
                ? t('授权完成，{name} 已注册为执行机。终端那边会自己连上，这一页可以关掉。', {
                    name,
                  })
                : t('授权完成，执行机已注册。终端那边会自己连上，这一页可以关掉。')}
            </p>
          )}
          {phase === 'expired' && (
            <p className={`${DESC_CLASS} [&_code]:whitespace-nowrap`}>
              {withCodeSpans(t('授权链接过期了。在执行机上重新运行 `cairn start` 拿新链接。'))}
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
