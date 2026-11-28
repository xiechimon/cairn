import type { DoubaoSubscription } from '@cairn/shared';
import { isRegisteredMachine } from '@cairn/shared';
import { useEffect, useState } from 'react';
import type { CreateDoubaoSubscription } from '../api/doubao-subscriptions.js';
import { useMachines, useTeams } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { FORM_CONTROL_CLS, FormActions, FormField, FormStack } from '../components/form-layout.js';
import { machineDisplayName } from '../components/machine-label.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select.js';
import { useI18n } from '../i18n/provider.js';
import { DoubaoQrLoginCard } from './doubao-qr-login.js';

export function AddDoubaoSubscriptionDialog({
  teamId,
  onClose,
  onCreate,
  onFinish,
  pending,
  error,
}: {
  teamId: string | undefined;
  onClose: () => void;
  onCreate: (
    body: CreateDoubaoSubscription,
    onSaved?: (created: DoubaoSubscription) => void,
  ) => void;
  onFinish: (created: DoubaoSubscription) => void;
  pending: boolean;
  error: boolean;
}) {
  const { t } = useI18n();
  const { live, teamId: liveTeamId } = useLiveData();
  const resolvedTeamId = teamId ?? liveTeamId;
  const teamsQ = useTeams(live);
  const machinesQ = useMachines(resolvedTeamId, live);
  const [label, setLabel] = useState(t('豆包订阅'));
  const [savedQr, setSavedQr] = useState<{
    sub: DoubaoSubscription;
    runner: { id: string; name: string };
  } | null>(null);

  const defaultMachineId =
    (teamsQ.data?.find((team) => team.id === resolvedTeamId) ?? teamsQ.data?.[0])
      ?.defaultMachineId ?? null;
  const machines = (machinesQ.data ?? []).filter(isRegisteredMachine);
  const loggedInRunners = machines.filter(
    (m) => m.online && m.capabilities?.doubao?.authenticated === true,
  );
  const supportedOnlineRunners = machines.filter(
    (m) =>
      m.online &&
      m.capabilities?.doubao !== undefined &&
      m.capabilities.doubao.platformSupported !== false,
  );
  const preferredDefaultRunner =
    defaultMachineId !== null
      ? supportedOnlineRunners.find((m) => m.id === defaultMachineId)
      : undefined;
  const defaultQrRunner =
    preferredDefaultRunner ??
    supportedOnlineRunners.find((m) => m.capabilities?.doubao?.authenticated !== true) ??
    supportedOnlineRunners[0];
  const [qrRunnerId, setQrRunnerId] = useState<string>(defaultQrRunner?.id ?? '');

  useEffect(() => {
    if (qrRunnerId === '' && defaultQrRunner !== undefined) {
      setQrRunnerId(defaultQrRunner.id);
    }
  }, [qrRunnerId, defaultQrRunner]);

  const selectedQrRunner =
    supportedOnlineRunners.find((m) => m.id === qrRunnerId) ?? defaultQrRunner;
  const anyLoggedIn = loggedInRunners.length > 0;
  const needsQr = !anyLoggedIn && selectedQrRunner !== undefined;
  const canSave = !pending && label.trim() !== '';

  const formContent = (
    <AddDoubaoSubscriptionForm
      anyLoggedIn={anyLoggedIn}
      loggedInRunnerName={
        loggedInRunners[0] === undefined ? undefined : machineDisplayName(loggedInRunners[0])
      }
      selectedQrRunnerName={
        selectedQrRunner === undefined ? undefined : machineDisplayName(selectedQrRunner)
      }
      label={label}
      onLabelChange={setLabel}
      supportedOnlineRunners={supportedOnlineRunners.map((machine) => ({
        ...machine,
        name: machineDisplayName(machine),
      }))}
      qrRunnerId={qrRunnerId}
      onQrRunnerChange={setQrRunnerId}
      error={error}
    />
  );

  if (savedQr !== null) {
    return (
      <DoubaoQrLoginCard
        teamId={resolvedTeamId}
        machineId={savedQr.runner.id}
        machineName={savedQr.runner.name}
        autoStart
        canManage
        onSucceeded={() => onFinish(savedQr.sub)}
        onCancel={() => onFinish(savedQr.sub)}
        onLater={() => onFinish(savedQr.sub)}
      />
    );
  }

  return (
    <DialogShell
      title={t('添加豆包订阅')}
      open
      onClose={onClose}
      size="s"
      footer={
        <FormActions
          className="pt-0"
          primary={{
            label: needsQr ? t('保存并扫码登录') : t('保存'),
            disabled: !canSave,
            onClick: () =>
              onCreate(
                { label: label.trim(), runnerId: null },
                needsQr && selectedQrRunner !== undefined
                  ? (created) =>
                      setSavedQr({
                        sub: created,
                        runner: {
                          id: selectedQrRunner.id,
                          name: machineDisplayName(selectedQrRunner),
                        },
                      })
                  : undefined,
              ),
          }}
          secondary={{ label: t('取消'), onClick: onClose }}
        />
      }
    >
      {formContent}
    </DialogShell>
  );
}

export function AddDoubaoSubscriptionForm({
  anyLoggedIn,
  loggedInRunnerName,
  selectedQrRunnerName,
  label,
  onLabelChange,
  supportedOnlineRunners,
  qrRunnerId,
  onQrRunnerChange,
  error,
}: {
  anyLoggedIn: boolean;
  loggedInRunnerName?: string | undefined;
  selectedQrRunnerName?: string | undefined;
  label: string;
  onLabelChange: (value: string) => void;
  supportedOnlineRunners: readonly { id: string; name: string }[];
  qrRunnerId: string;
  onQrRunnerChange: (value: string) => void;
  error: boolean;
}) {
  const { t } = useI18n();
  return (
    <FormStack className="max-w-none">
      {anyLoggedIn && loggedInRunnerName !== undefined ? (
        <div data-testid="doubao-local-hint" className="flex flex-col gap-1">
          <p className="m-0 text-meta text-content-secondary">
            {t('已在 {machine} 登录豆包', { machine: loggedInRunnerName })}
          </p>
          <p className="m-0 text-meta text-content-tertiary">
            {t(
              '豆包任务会自动路由到已登录的电脑；其他电脑如需运行豆包，可在需要时直接在 Cairn 内扫码。',
            )}
          </p>
        </div>
      ) : selectedQrRunnerName !== undefined ? (
        <div data-testid="doubao-local-hint" className="flex flex-col gap-1">
          <p className="m-0 text-meta text-content-tertiary">
            {t(
              '保存后直接在下方展示 {machine} 的登录二维码，用手机豆包 App 扫码一次即可，无需打开终端。',
              {
                machine: selectedQrRunnerName,
              },
            )}
          </p>
        </div>
      ) : (
        <div data-testid="doubao-local-hint" className="flex flex-col gap-1">
          <p className="m-0 text-meta text-content-tertiary">
            {t('当前暂无可扫码的在线执行机；保存后，执行机上线时可直接在 Cairn 内扫码登录。')}
          </p>
        </div>
      )}
      <FormField label={t('名称')} htmlFor="doubao-subscription-label">
        <Input
          className={FORM_CONTROL_CLS}
          id="doubao-subscription-label"
          data-testid="doubao-subscription-label"
          value={label}
          onChange={(event) => onLabelChange(event.target.value)}
        />
      </FormField>
      {!anyLoggedIn && supportedOnlineRunners.length > 1 && (
        <FormField label={t('扫码电脑')} htmlFor="doubao-subscription-runner">
          <Select
            value={qrRunnerId}
            onValueChange={(value) => {
              if (value !== null) onQrRunnerChange(value);
            }}
          >
            <SelectTrigger
              id="doubao-subscription-runner"
              data-testid="doubao-subscription-runner"
              className={FORM_CONTROL_CLS}
            >
              <SelectValue>
                {supportedOnlineRunners.find((m) => m.id === qrRunnerId)?.name ?? ''}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {supportedOnlineRunners.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      )}
      {error && <p role="alert">{t('保存失败，请检查填写内容后重试。')}</p>}
    </FormStack>
  );
}
