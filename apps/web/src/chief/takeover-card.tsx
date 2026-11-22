import { COMPUTER_HANDOFF_TIMEOUT_MS } from '@cairn/shared';
import { cn } from 'cn';
import { useEffect, useState } from 'react';
import { useApiMutations, useComputers, usePhoneHandoffs } from '../api/hooks.js';
import { clockTime } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { useComputerControl } from '../api/use-computer-control.js';
import { ComputerScreenDialog } from '../board/computer-screen-dialog.js';
import { useScreenHoverControl } from '../board/screen-hover-control.js';
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

function PhoneTakeoverButtons({ item, waiting }: { item: TakeoverItem; waiting: boolean }) {
  const { t } = useI18n();
  const { teamId } = useLiveData();
  const mutations = useApiMutations(teamId);
  const handoffsQ = usePhoneHandoffs(waiting);
  const target = handoffsQ.data?.find((row) => row.name === item.phone) ?? null;
  const handback = () => {
    if (target === null) return;
    mutations.handbackPhone.mutate({ machineId: target.machineId, phoneId: target.phoneId });
  };
  if (!waiting) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-3">
      <Button
        type="button"
        size="sm"
        className="pointer-coarse:h-11 pointer-coarse:px-4"
        disabled={target === null || mutations.handbackPhone.isPending}
        data-testid="chief-takeover-handback"
        onClick={handback}
      >
        {t('我已操作完，交还')}
      </Button>
      {target === null && (
        <span className="text-meta text-content-tertiary">{t('正在连接手机状态…')}</span>
      )}
    </div>
  );
}

export function TakeoverCard({ item }: { item: TakeoverItem }) {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const waiting = item.outcome === 'waiting';
  const onPhone = item.phone !== undefined;
  const computersQ = useComputers(teamId, live && waiting && !onPhone, COMPUTERS_REFRESH_MS);
  const computer = computersQ.data?.[0] ?? null;
  const control = useComputerControl({ teamId, computer });
  const hover = useScreenHoverControl(control, computer?.handoffReason != null);
  const [open, setOpen] = useState(false);
  const now = useNow(waiting);
  const push = useDevicePushOff(teamId, waiting);
  const left = minutesLeft(item.startedAt, now);
  const online = computer?.machine.online === true && computer.state !== 'failed';
  const held = waiting && control.controlHeld;

  const title = !waiting
    ? item.outcome === 'handed-back'
      ? item.endedAt !== null
        ? t('你已交还 · {time}', { time: clockTime(item.endedAt) })
        : t('你已交还')
      : t('没有完成')
    : held
      ? t('你正在操作电脑')
      : onPhone
        ? t('需要你操作手机 {name}', { name: item.phone ?? '' })
        : t('需要你登录');

  const meta = !waiting
    ? item.outcome === 'handed-back'
      ? t('Coordinator 已继续')
      : t('这一步已停止，不会自动重试')
    : held
      ? t('Coordinator 已暂停，不读取屏幕')
      : item.reason !== ''
        ? item.reason
        : onPhone
          ? t('在手机上完成后点“交还”，Coordinator 继续。')
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
            {t('这台设备未开启推送，可能无法收到下次提醒。')}{' '}
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
        {waiting && onPhone && <PhoneTakeoverButtons item={item} waiting={waiting} />}
        {waiting && !onPhone && (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              size="sm"
              className="pointer-coarse:h-11 pointer-coarse:px-4"
              disabled={!online}
              data-testid="chief-takeover-open"
              onClick={() => setOpen(true)}
            >
              {t('打开画面')}
            </Button>
            {!online ? (
              <span className="text-meta text-content-tertiary">
                {computer === null ? t('尚未连接电脑') : t('电脑离线')}
              </span>
            ) : (
              control.failed && (
                <span className="text-meta text-destructive" data-testid="chief-takeover-failed">
                  {t('未能接管，电脑没有响应')}
                </span>
              )
            )}
          </div>
        )}
      </section>
      {open && waiting && computer !== null && teamId !== undefined && (
        <ComputerScreenDialog
          onClose={() => setOpen(false)}
          title={computer.machine.name}
          teamId={teamId}
          computer={computer}
          control={control}
          hover={hover}
          note={timeLeft ?? undefined}
        />
      )}
    </MessageScrollerItem>
  );
}
