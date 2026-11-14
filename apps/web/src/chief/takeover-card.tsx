import { COMPUTER_HANDOFF_TIMEOUT_MS } from '@cairn/shared';
import { cn } from 'cn';
import { useEffect, useState } from 'react';
import { useComputers } from '../api/hooks.js';
import { clockTime } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { useComputerControl } from '../api/use-computer-control.js';
import { ComputerScreenDialog } from '../board/computer-screen-dialog.js';
import { Button } from '../components/ui/button.js';
import { MessageScrollerItem } from '../components/ui/message-scroller.js';
import { REPLY_BUBBLE_CLS } from '../detail/chat-markdown.js';
import type { ChiefStreamItem } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import {
  currentDeviceSubscription,
  pushDeviceSupported,
  subscribeDevicePush,
} from '../pwa/push-device.js';

type TakeoverItem = Extract<ChiefStreamItem, { kind: 'takeover' }>;

const TICK_MS = 15_000;
const COMPUTERS_REFRESH_MS = 3_000;

function minutesLeft(startedAt: number | null, now: number): number | null {
  if (startedAt === null) return null;
  return Math.max(0, Math.ceil((startedAt + COMPUTER_HANDOFF_TIMEOUT_MS - now) / 60_000));
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const tick = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(tick);
  }, [active]);
  return now;
}

function useDevicePushOff(teamId: string | undefined, active: boolean) {
  const [off, setOff] = useState(false);
  useEffect(() => {
    if (!active || !pushDeviceSupported()) return;
    let cancelled = false;
    void currentDeviceSubscription()
      .then((subscription) => {
        if (!cancelled) setOff(subscription === null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [active]);
  const turnOn = () => {
    if (teamId === undefined) return;
    void subscribeDevicePush(teamId)
      .then(() => setOff(false))
      .catch(() => {});
  };
  return { off, turnOn };
}

export function TakeoverCard({ item }: { item: TakeoverItem }) {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const waiting = item.outcome === 'waiting';
  const computersQ = useComputers(teamId, live && waiting, COMPUTERS_REFRESH_MS);
  const computer = computersQ.data?.[0] ?? null;
  const control = useComputerControl({ teamId, computer });
  const [open, setOpen] = useState(false);
  const now = useNow(waiting);
  const push = useDevicePushOff(teamId, waiting);
  const left = minutesLeft(item.startedAt, now);
  const online = computer?.machine.online === true && computer.state !== 'failed';
  const held = waiting && control.controlHeld;

  const takeOver = () => {
    control.setHeld(true);
    setOpen(true);
  };

  useEffect(() => {
    if (control.failed) setOpen(false);
  }, [control.failed]);

  const title = !waiting
    ? item.outcome === 'handed-back'
      ? item.endedAt !== null
        ? t('你已交还 · {time}', { time: clockTime(item.endedAt) })
        : t('你已交还')
      : t('没有完成')
    : held
      ? t('你正在操作电脑')
      : t('需要你登录');

  const meta = !waiting
    ? item.outcome === 'handed-back'
      ? t('Coordinator 已继续')
      : t('这一步已停止，不会自动重试')
    : held
      ? t('Coordinator 已暂停，不读取屏幕')
      : item.reason;
  const timeLeft = waiting && left !== null ? t('还剩 {n} 分钟', { n: left }) : null;

  return (
    <MessageScrollerItem style={{ contentVisibility: 'visible' }} className="mt-5">
      <section
        data-testid="chief-takeover"
        data-outcome={item.outcome}
        data-held={held ? 'true' : 'false'}
        aria-label={t('需要你登录')}
        className={cn(REPLY_BUBBLE_CLS, 'flex flex-col gap-1 py-3')}
      >
        <p className="m-0 flex items-center gap-2 text-ui font-title text-foreground">
          {waiting && !held && (
            <span
              aria-hidden="true"
              data-slot="needs-you-dot"
              className="size-1.5 flex-none rounded-full bg-(--card-button)"
            />
          )}
          {title}
        </p>
        {meta !== '' && <p className="m-0 text-meta text-content-secondary">{meta}</p>}
        {timeLeft !== null && (
          <p className="m-0 text-meta text-content-tertiary" data-testid="chief-takeover-time-left">
            {timeLeft}
          </p>
        )}
        {waiting && push.off && (
          <p className="m-0 text-meta text-content-tertiary">
            {t('这台设备没开推送，下次可能收不到提醒。')}{' '}
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 text-meta"
              data-testid="chief-takeover-push-on"
              onClick={push.turnOn}
            >
              {t('开启推送')}
            </Button>
          </p>
        )}
        {waiting && (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {held ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  className="pointer-coarse:h-11 pointer-coarse:px-4"
                  disabled={control.busy}
                  data-testid="chief-takeover-give-back"
                  onClick={() => control.setHeld(false)}
                >
                  {t('交还')}
                </Button>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0 pointer-coarse:h-11"
                  data-testid="chief-takeover-open"
                  disabled={!online}
                  onClick={() => setOpen(true)}
                >
                  {t('打开画面')}
                </Button>
              </>
            ) : (
              <Button
                type="button"
                size="sm"
                className="pointer-coarse:h-11 pointer-coarse:px-4"
                disabled={!online || control.busy}
                data-testid="chief-takeover-take"
                onClick={takeOver}
              >
                {t('接管')}
              </Button>
            )}
            {!online ? (
              <span className="text-meta text-content-tertiary">
                {computer === null ? t('还没有连上电脑') : t('电脑离线')}
              </span>
            ) : (
              control.failed && (
                <span className="text-meta text-destructive" data-testid="chief-takeover-failed">
                  {t('没能接管，电脑没有响应')}
                </span>
              )
            )}
          </div>
        )}
      </section>
      {open && waiting && computer !== null && teamId !== undefined && (
        <ComputerScreenDialog
          open={open}
          onClose={() => setOpen(false)}
          title={computer.machine.name}
          teamId={teamId}
          computer={computer}
          control={control}
          status={
            left !== null
              ? held
                ? t('你在控制 · 还剩 {n} 分钟', { n: left })
                : t('接管后才能点击和键入')
              : undefined
          }
        />
      )}
    </MessageScrollerItem>
  );
}
