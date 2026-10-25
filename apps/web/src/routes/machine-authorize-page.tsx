import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { api } from '../api/client.js';
import { Button } from '../components/ui/button.js';
import { Card } from '../components/ui/card.js';
import { useI18n } from '../i18n/provider.js';

interface MachineJson {
  machineId: string;
  token: string;
  teamId: string;
  serverUrl: string;
}

type Phase = 'idle' | 'pending' | 'authorizing' | 'authorized' | 'expired' | 'error';

const POLL_INTERVAL_MS = 2_000;

const DESC_CLASS = 'text-[13px] leading-normal text-content-secondary';

export function MachineAuthorizePage() {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const [enrollId, setEnrollId] = useState(searchParams.get('enroll'));
  const [phase, setPhase] = useState<Phase>(enrollId !== null ? 'pending' : 'idle');
  const [machine, setMachine] = useState<MachineJson | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stopped = useRef(false);
  useEffect(() => {
    stopped.current = false;
    return () => {
      stopped.current = true;
    };
  }, [enrollId]);

  useEffect(() => {
    if (enrollId === null || phase !== 'pending') return;
    const tick = async () => {
      try {
        const res = await api.post<{ status: string; machine?: MachineJson }>(
          '/api/machine/enroll/poll',
          { enrollId },
        );
        if (stopped.current) return;
        if (res.status === 'authorized' && res.machine) {
          setMachine(res.machine);
          setPhase('authorized');
        } else if (res.status === 'expired') {
          setPhase('expired');
        }
      } catch {}
    };
    void tick();
    const timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [enrollId, phase]);

  const startEnrollment = async (): Promise<void> => {
    setError(null);
    try {
      const res = await api.post<{ enrollId: string }>('/api/machine/enroll/start', {});
      setEnrollId(res.enrollId);
      setPhase('pending');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const confirm = async (): Promise<void> => {
    if (enrollId === null || phase !== 'pending') return;
    setPhase('authorizing');
    setError(null);
    try {
      const res = await api.post<{ machine: MachineJson }>('/api/machine/enroll/confirm', {
        enrollId,
      });
      setMachine(res.machine);
      setPhase('authorized');
    } catch (err) {
      setPhase('pending');
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="authorize-backdrop fixed inset-0 flex items-center justify-center bg-background">
      <Card
        role="region"
        aria-label={t('授权机器')}
        className="w-[360px] max-w-[calc(100vw-48px)] gap-3 p-6"
      >
        <h1 className="text-base font-semibold text-foreground">{t('授权机器')}</h1>
        {phase === 'idle' && (
          <>
            <p className={DESC_CLASS}>{t('生成授权链接，在执行机上完成注册发起。')}</p>
            <Button className="w-full" onClick={() => void startEnrollment()}>
              {t('生成授权链接')}
            </Button>
          </>
        )}
        {phase === 'pending' && (
          <>
            <p className={DESC_CLASS}>
              {t('一台执行机请求加入你的团队。确认后它将以自己的凭据连接。')}
            </p>
            <Button className="w-full" onClick={() => void confirm()}>
              {t('确认授权')}
            </Button>
          </>
        )}
        {phase === 'authorizing' && <p className={DESC_CLASS}>{t('正在授权…')}</p>}
        {phase === 'authorized' && machine !== null && (
          <>
            <p className={DESC_CLASS}>{t('授权完成，机器已注册。')}</p>
            <p className="text-xs break-all text-content-tertiary">
              machineId: {machine.machineId}
            </p>
          </>
        )}
        {phase === 'expired' && (
          <p className={DESC_CLASS}>{t('授权链接已失效，请在执行机上重新发起。')}</p>
        )}
        {error !== null && phase !== 'authorized' && (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
      </Card>
    </div>
  );
}
