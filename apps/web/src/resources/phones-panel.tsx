import { isPrivateIpv4Endpoint } from '@cairn/shared';
import { cn } from 'cn';
import { Smartphone } from 'lucide-react';
import { useState } from 'react';
import { useApiMutations, usePhones } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { FORM_CONTROL_CLS, FormField, FormStack } from '../components/form-layout.js';
import { Button } from '../components/ui/button.js';
import { Checkbox } from '../components/ui/checkbox.js';
import {
  DIALOG_PRIMARY_BUTTON,
  DIALOG_TEXT_BUTTON,
  DialogShell,
} from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import { toastError } from '../components/ui/toaster.js';
import { blockDemoWrite } from '../demo/demo-gate.js';
import type { MachineRow } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';
import { DeleteConfirm } from '../overlay/delete-confirm.js';
import { mergePhoneViews, type PhoneView } from './phone-views.js';

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
    case 're_pair':
      return t('需要重新配对');
  }
}

const ENDPOINT_RE = /^\d{1,3}(\.\d{1,3}){3}:\d{1,5}$/;
const CODE_RE = /^\d{6}$/;

export function PhonePairDialog({
  open,
  machineId,
  machineName,
  phoneId,
  prefillEndpoint,
  prefillName = '',
  onClose,
}: {
  open: boolean;
  machineId: string;
  machineName: string;
  phoneId: string | null;
  prefillEndpoint: string;
  prefillName?: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const mutations = useApiMutations(teamId);
  const [name, setName] = useState(prefillName);
  const [endpoint, setEndpoint] = useState(prefillEndpoint);
  const [code, setCode] = useState('');
  const [consent, setConsent] = useState(false);
  const endpointOk = isPrivateIpv4Endpoint(endpoint.trim());
  const codeOk = CODE_RE.test(code.trim());
  const ready = endpointOk && codeOk && consent;
  const pending = mutations.pairPhone.isPending || mutations.retryPairPhone.isPending;

  const submit = () => {
    if (!ready || pending) return;
    if (!live) {
      blockDemoWrite();
      return;
    }
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
    <DialogShell
      open={open}
      onClose={onClose}
      stacked
      dismissible={!pending}
      size="m"
      title={t('配对手机')}
      subtitle={t(
        '需要安卓 11 及以上。在手机上：开发者选项 → 无线调试 → 使用配对码配对设备，把显示的 IP:端口 和 6 位配对码填到这里。手机和这台电脑要在同一无线局域网内，{name} 会通过 adb 连接手机。',
        { name: machineName },
      )}
      footer={
        <>
          <Button
            variant="ghost"
            className={DIALOG_TEXT_BUTTON}
            disabled={pending}
            onClick={onClose}
          >
            {t('取消')}
          </Button>
          <Button
            className={DIALOG_PRIMARY_BUTTON}
            data-testid="phone-pair-submit"
            disabled={!ready || pending}
            aria-busy={pending}
            onClick={submit}
          >
            {t('配对')}
          </Button>
        </>
      }
    >
      <div data-testid="phone-pair-dialog">
        <FormStack className="max-w-none">
          <FormField label={t('手机名称（可选）')} htmlFor="phone-pair-name">
            <Input
              id="phone-pair-name"
              data-testid="phone-pair-name"
              className={FORM_CONTROL_CLS}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('例如 Pixel 8a')}
            />
          </FormField>
          <FormField label={t('IP:端口')} htmlFor="phone-pair-endpoint">
            <Input
              id="phone-pair-endpoint"
              data-testid="phone-pair-endpoint"
              className={FORM_CONTROL_CLS}
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              placeholder="192.168.1.20:37123"
              inputMode="text"
              autoComplete="off"
            />
          </FormField>
          <FormField label={t('6 位配对码')} htmlFor="phone-pair-code">
            <Input
              id="phone-pair-code"
              data-testid="phone-pair-code"
              className={FORM_CONTROL_CLS}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="123456"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
            />
          </FormField>
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
                '我了解配对后 Coordinator 可以像使用电脑一样查看和操作这台手机：屏幕截图和元素文字会发送给服务商，输入中文等文字时会在手机临时目录推送输入辅助工具。发消息、付款、改设置前会先询问我。',
              )}
            </span>
          </label>
        </FormStack>
      </div>
    </DialogShell>
  );
}

function capabilityText(view: PhoneView, t: TFunc): string {
  return view.state === 'not_paired' ? t('配对后可供 Agent 查看和操作') : t('Agent 可查看和操作');
}

function stateDotClass(state: PhoneView['state']): string {
  switch (state) {
    case 'ready':
    case 'busy':
      return 'bg-running';
    case 'pairing':
    case 'locked':
    case 'handoff':
      return 'bg-pebble-waiting';
    case 're_pair':
    case 'signing_expired':
      return 'bg-tint-fail-ink';
    case 'not_paired':
    case 'unreachable':
      return 'bg-content-dim';
  }
}

export function MachinePhoneRows({
  machine,
  onOpenPair,
}: {
  machine: MachineRow;
  onOpenPair: (target: { phoneId: string | null; endpoint: string; name: string }) => void;
}) {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const mutations = useApiMutations(teamId);
  const machineId = machine.id ?? '';
  const macHost =
    machine.id != null && machine.kind === 'local' && machine.capabilities?.osPlatform === 'darwin';
  const hostable = macHost && machine.online !== false;
  const phonesQ = usePhones(machine.id, live && macHost);
  const rows = live ? (phonesQ.data ?? []) : (machine.phonesFixture?.phones ?? []);
  const reported = hostable ? (machine.capabilities?.phones ?? []) : [];
  const views = mergePhoneViews(reported, rows);
  const [forgetTarget, setForgetTarget] = useState<PhoneView | null>(null);

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

  if (views.length === 0 && forgetTarget === null) return null;

  return (
    <>
      {views.map((view) => (
        <div
          key={view.key}
          data-testid="phone-row"
          data-state={view.state}
          className="flex min-w-0 items-center gap-3 border-b border-border px-4 py-2 last:border-b-0 pointer-coarse:pb-3"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex min-w-0 items-center gap-2 text-ui font-medium text-foreground">
              <Smartphone
                aria-hidden
                strokeWidth={1.75}
                className="size-4 flex-none text-content-secondary"
              />
              <span className="min-w-0 wrap-anywhere" data-testid="phone-name">
                {view.name}
              </span>
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-meta">
              <span data-testid="phone-kind" className="whitespace-nowrap text-content-secondary">
                {t('安卓手机')}
              </span>
              <span aria-hidden className="text-content-dim">
                ·
              </span>
              <span
                data-testid="phone-capability"
                className="whitespace-nowrap text-content-secondary"
              >
                {capabilityText(view, t)}
              </span>
              <span aria-hidden className="text-content-dim">
                ·
              </span>
              <span
                aria-hidden
                className={cn(
                  'grow-light size-1.5 flex-none rounded-full',
                  stateDotClass(view.state),
                )}
              />
              <span className="min-w-0 truncate text-content-secondary" data-testid="phone-state">
                {stateText(view, t)}
                {view.row?.lastError != null && view.row.lastError !== '' && (
                  <span className="text-destructive"> · {view.row.lastError}</span>
                )}
              </span>
            </div>
          </div>
          <span className="flex flex-none items-center gap-1">
            {view.state === 'not_paired' && (
              <Button
                variant="outline"
                size="sm"
                data-testid="phone-pair"
                onClick={() => {
                  const prefill = ENDPOINT_RE.test(view.deviceId)
                    ? `${view.deviceId.slice(0, view.deviceId.lastIndexOf(':'))}:`
                    : '';
                  onOpenPair({ phoneId: null, endpoint: prefill, name: '' });
                }}
              >
                {t('配对')}
              </Button>
            )}
            {view.row !== null &&
              (view.state === 're_pair' ||
                (view.row.lastError !== null && view.row.lastError !== '')) && (
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="phone-retry"
                  onClick={() => {
                    if (view.row === null) return;
                    onOpenPair({ phoneId: view.row.id, endpoint: '', name: view.name });
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
        </div>
      ))}
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
  );
}
