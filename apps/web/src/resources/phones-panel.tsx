import type { MachinePhoneReport, PhoneActivity, PhoneRow } from '@cairn/shared';
import { cn } from 'cn';
import { Smartphone } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useApiMutations, usePhoneActivity, usePhones } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { relativeTime } from '../board/rel-time.js';
import { Button } from '../components/ui/button.js';
import { Checkbox } from '../components/ui/checkbox.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog.js';
import { Input } from '../components/ui/input.js';
import { toastError } from '../components/ui/toaster.js';
import { blockDemoWrite } from '../demo/demo-gate.js';
import type { MachineRow } from '../fixtures/records.js';
import { useMinuteClock } from '../hooks/use-minute-clock.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';
import { ChevronDown } from '../icons/index.js';
import { DeleteConfirm } from '../overlay/delete-confirm.js';

export function shouldShowPhones(machine: MachineRow): boolean {
  return (
    machine.capabilities?.phoneHost === true ||
    (machine.capabilities?.phones?.length ?? 0) > 0 ||
    (machine.phonesFixture?.phones?.length ?? 0) > 0
  );
}

type PhoneViewState =
  | 'not_paired'
  | 'pairing'
  | 'ready'
  | 'busy'
  | 'locked'
  | 'handoff'
  | 'unreachable'
  | 'signing_expired';

interface PhoneView {
  key: string;
  deviceId: string;
  name: string;
  row: PhoneRow | null;
  link: MachinePhoneReport['link'] | null;
  state: PhoneViewState;
}

function viewOf(row: PhoneRow | null, link: MachinePhoneReport['link'] | null): PhoneViewState {
  if (row === null) return 'not_paired';
  if (row.handoff) return 'handoff';
  if (row.pairing || link === 'seen' || link === 'unauthorized') return 'pairing';
  if (link === 'ready') return row.busy ? 'busy' : 'ready';
  if (link === 'locked') return 'locked';
  if (link === 'signing_expired') return 'signing_expired';
  return 'unreachable';
}

function mergeViews(
  reported: readonly MachinePhoneReport[],
  rows: readonly PhoneRow[],
): PhoneView[] {
  const views = new Map<string, PhoneView>();
  for (const phone of reported) {
    const row = rows.find((entry) => entry.deviceId === phone.deviceId) ?? null;
    views.set(phone.deviceId, {
      key: phone.deviceId,
      deviceId: phone.deviceId,
      name: row?.name ?? phone.name,
      row,
      link: phone.link,
      state: viewOf(row, phone.link),
    });
  }
  for (const row of rows) {
    if (views.has(row.deviceId)) continue;
    views.set(row.deviceId, {
      key: row.deviceId,
      deviceId: row.deviceId,
      name: row.name,
      row,
      link: null,
      state: viewOf(row, null),
    });
  }
  return [...views.values()];
}

function stateText(view: PhoneView, t: TFunc): string {
  switch (view.state) {
    case 'not_paired':
      return t('未配对');
    case 'pairing':
      return t('配对中');
    case 'ready':
      return t('就绪');
    case 'busy':
      return t('使用中');
    case 'locked':
      return t('已锁定，需要主人解锁');
    case 'handoff':
      return t('主人正在操作');
    case 'signing_expired':
      return t('签名已过期');
    case 'unreachable':
      return t('无法连接');
  }
}

function activityVerb(row: PhoneActivity, t: TFunc): string {
  if (row.tool === 'phone_act') return t('操作手机');
  if (row.tool === 'phone_manage') return t('管理');
  return t('查看手机');
}

const ENDPOINT_RE = /^\d{1,3}(\.\d{1,3}){3}:\d{1,5}$/;
const CODE_RE = /^\d{6}$/;

export function PhonePairDialog({
  open,
  machineId,
  machineName,
  phoneId,
  prefillEndpoint,
  onClose,
}: {
  open: boolean;
  machineId: string;
  machineName: string;
  phoneId: string | null;
  prefillEndpoint: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { teamId } = useLiveData();
  const mutations = useApiMutations(teamId);
  const [name, setName] = useState('');
  const [endpoint, setEndpoint] = useState(prefillEndpoint);
  const [code, setCode] = useState('');
  const [consent, setConsent] = useState(false);
  const endpointOk = ENDPOINT_RE.test(endpoint.trim());
  const codeOk = CODE_RE.test(code.trim());
  const ready = endpointOk && codeOk && consent;
  const pending = mutations.pairPhone.isPending || mutations.retryPairPhone.isPending;

  const submit = () => {
    if (!ready || pending) return;
    const body = {
      endpoint: endpoint.trim(),
      code: code.trim(),
      ...(name.trim() !== '' ? { name: name.trim() } : {}),
      consent: true as const,
    };
    const done = {
      onSuccess: () => onClose(),
      onError: (error: unknown) => toastError(t('配对失败，请重试。'), error),
    };
    if (phoneId !== null) mutations.retryPairPhone.mutate({ machineId, phoneId, body }, done);
    else mutations.pairPhone.mutate({ machineId, body }, done);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent data-testid="phone-pair-dialog">
        <DialogHeader>
          <DialogTitle>{t('配对手机')}</DialogTitle>
          <DialogDescription>
            {t(
              '在手机上：开发者选项 → 无线调试 → 使用配对码配对设备，把显示的 IP:端口 和 6 位配对码填到这里。{name} 会通过 adb 连接手机。',
              {
                name: machineName,
              },
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-w-0 flex-col gap-3">
          <label
            htmlFor="phone-pair-name"
            className="flex flex-col gap-1 text-meta text-content-secondary"
          >
            {t('手机名称（可选）')}
            <Input
              id="phone-pair-name"
              data-testid="phone-pair-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('例如 Pixel 8a')}
            />
          </label>
          <label
            htmlFor="phone-pair-endpoint"
            className="flex flex-col gap-1 text-meta text-content-secondary"
          >
            {t('IP:端口')}
            <Input
              id="phone-pair-endpoint"
              data-testid="phone-pair-endpoint"
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              placeholder="192.168.1.20:37123"
              inputMode="text"
              autoComplete="off"
            />
          </label>
          <label
            htmlFor="phone-pair-code"
            className="flex flex-col gap-1 text-meta text-content-secondary"
          >
            {t('6 位配对码')}
            <Input
              id="phone-pair-code"
              data-testid="phone-pair-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="123456"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
            />
          </label>
          <label
            htmlFor="phone-pair-consent"
            className="flex items-start gap-2 text-meta text-content-secondary"
          >
            <Checkbox
              id="phone-pair-consent"
              data-testid="phone-pair-consent"
              checked={consent}
              onCheckedChange={(next) => setConsent(next === true)}
              className="mt-0.5"
            />
            <span>
              {t(
                '我了解配对后 Coordinator 可以像使用电脑一样查看和操作这台手机：屏幕截图和元素文字会发送给服务商。发消息、付款、改设置前会先询问我。',
              )}
            </span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t('取消')}
          </Button>
          <Button
            data-testid="phone-pair-submit"
            disabled={!ready || pending}
            aria-busy={pending}
            onClick={submit}
          >
            {t('配对')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function usePhonesRow(machine: MachineRow): {
  shown: boolean;
  meta: ReactNode;
  drawer: ReactNode;
} {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const mutations = useApiMutations(teamId);
  const machineId = machine.id ?? '';
  const machineName = machine.name ?? machineId;
  const shown = shouldShowPhones(machine);
  const phonesQ = usePhones(machineId, live && shown);
  const activityQ = usePhoneActivity(machineId, live && shown);
  const now = useMinuteClock();
  const rows = live ? (phonesQ.data ?? []) : (machine.phonesFixture?.phones ?? []);
  const activity = live ? (activityQ.data ?? []) : (machine.phonesFixture?.activity ?? []);
  const reported = machine.capabilities?.phones ?? [];
  const views = mergeViews(reported, rows);
  const [open, setOpen] = useState(false);
  const [pairOpen, setPairOpen] = useState<{ phoneId: string | null; endpoint: string } | null>(
    null,
  );
  const [forgetTarget, setForgetTarget] = useState<PhoneView | null>(null);
  const phoneHost = machine.capabilities?.phoneHost === true;
  const expanded = open;

  const forget = (view: PhoneView) => {
    setForgetTarget(null);
    if (view.row === null) return;
    if (!live) {
      blockDemoWrite();
      return;
    }
    mutations.forgetPhone.mutate(
      { machineId, phoneId: view.row.id },
      { onError: (error) => toastError(t('移除手机失败，请重试。'), error) },
    );
  };

  if (!shown) return { shown: false, meta: null, drawer: null };

  const readyCount = views.filter((view) => view.row !== null).length;
  const meta = (
    <>
      <span aria-hidden className="text-content-dim">
        ·
      </span>
      <Button
        variant="ghost"
        data-testid="phones-meta"
        aria-expanded={expanded}
        onClick={() => setOpen(!expanded)}
        className="h-auto min-h-0 gap-0.5 rounded-sm px-0 py-0 text-meta font-normal whitespace-nowrap text-content-tertiary hover:bg-transparent hover:text-foreground focus-visible:ring-2 focus-visible:ring-(--focus-ring) dark:hover:bg-transparent pointer-coarse:min-h-11"
      >
        {readyCount > 0 ? t('{n} 台手机', { n: readyCount }) : t('手机')}
        <ChevronDown
          aria-hidden
          className={cn(
            'size-3 flex-none transition-transform duration-(--dur-fast)',
            expanded && 'rotate-180',
          )}
        />
      </Button>
    </>
  );

  const drawer = !expanded ? null : (
    <div
      data-testid="phones-drawer"
      className="flex min-w-0 flex-col gap-2 border-t border-border px-4 py-2"
    >
      {!phoneHost && live && (
        <p className="m-0 text-meta text-content-secondary" data-testid="phones-no-adb">
          {t(
            '这台执行机上没有找到 adb。安装 Android platform-tools（brew install --cask android-platform-tools）后重启 runner。',
          )}
        </p>
      )}
      {views.length === 0 && (
        <p className="m-0 text-meta text-content-secondary" data-testid="phones-empty">
          {t('没有发现手机。打开手机的无线调试后会出现在这里，或直接配对。')}
        </p>
      )}
      <ul data-testid="phones-list" className="m-0 flex list-none flex-col p-0">
        {views.map((view) => (
          <li
            key={view.key}
            data-testid="phone-row"
            data-state={view.state}
            className="flex min-w-0 items-center gap-3 py-1.5"
          >
            <Smartphone
              aria-hidden
              strokeWidth={1.75}
              className="size-4 flex-none text-content-tertiary"
            />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="min-w-0 truncate text-ui text-foreground" data-testid="phone-name">
                {view.name}
              </span>
              <span className="truncate text-meta text-content-tertiary" data-testid="phone-state">
                {stateText(view, t)}
                {view.row?.lastError != null && view.row.lastError !== '' && (
                  <span className="text-destructive"> · {view.row.lastError}</span>
                )}
              </span>
            </span>
            <span className="flex flex-none items-center gap-1">
              {view.state === 'not_paired' && (
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="phone-pair"
                  onClick={() => {
                    if (!live) {
                      blockDemoWrite();
                      return;
                    }
                    const prefill = ENDPOINT_RE.test(view.deviceId)
                      ? view.deviceId.slice(0, view.deviceId.lastIndexOf(':')) + ':'
                      : '';
                    setPairOpen({ phoneId: null, endpoint: prefill });
                  }}
                >
                  {t('配对')}
                </Button>
              )}
              {view.row !== null && view.row.lastError !== null && view.row.lastError !== '' && (
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="phone-retry"
                  onClick={() => {
                    if (!live) {
                      blockDemoWrite();
                      return;
                    }
                    setPairOpen({ phoneId: view.row!.id, endpoint: '' });
                  }}
                >
                  {t('重试')}
                </Button>
              )}
              {view.row !== null && (
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid="phone-forget"
                  className="text-content-tertiary"
                  onClick={() => setForgetTarget(view)}
                >
                  {t('移除')}
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {phoneHost && (
        <div>
          <Button
            variant="outline"
            size="sm"
            data-testid="phone-pair-manual"
            onClick={() => {
              if (!live) {
                blockDemoWrite();
                return;
              }
              setPairOpen({ phoneId: null, endpoint: '' });
            }}
          >
            {t('配对手机')}
          </Button>
        </div>
      )}
      {activity.length > 0 && (
        <ul data-testid="phone-activity" className="m-0 flex list-none flex-col p-0">
          {activity.map((row) => (
            <li
              key={row.callId}
              data-testid="phone-activity-row"
              className="flex min-w-0 items-center gap-3 py-1"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-mono text-meta text-foreground">{row.summary}</span>
                <span className="truncate text-meta text-content-tertiary">
                  {activityVerb(row, t)}
                  {row.phoneName !== null && ` · ${row.phoneName}`}
                  {row.threadTitle !== null && ` · ${row.threadTitle}`}
                  {(row.error !== null || (row.exitCode !== null && row.exitCode !== 0)) && (
                    <span className="text-destructive"> · {t('没有成功')}</span>
                  )}
                </span>
              </span>
              <span className="flex-none text-meta text-content-tertiary">
                {relativeTime(row.createdAt, now, t)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return {
    shown,
    meta,
    drawer: (
      <>
        {drawer}
        {pairOpen !== null && (
          <PhonePairDialog
            open
            machineId={machineId}
            machineName={machineName}
            phoneId={pairOpen.phoneId}
            prefillEndpoint={pairOpen.endpoint}
            onClose={() => setPairOpen(null)}
          />
        )}
        {forgetTarget !== null && (
          <DeleteConfirm
            open
            title={t('确定移除这台手机？Coordinator 会立刻失去对它的访问。')}
            summary={<span>{forgetTarget.name}</span>}
            ariaLabel={t('移除手机')}
            onClose={() => setForgetTarget(null)}
            onConfirm={() => forget(forgetTarget)}
          />
        )}
      </>
    ),
  };
}
