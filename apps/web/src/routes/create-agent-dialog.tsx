import { cn } from 'cn';
import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { FORM_CONTROL_CLS, FormActions, FormField, FormStack } from '../components/form-layout.js';
import { CARD_RADIUS_CLS } from '../components/settings-list.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import { SeededAvatar } from '../components/ui/seeded-avatar.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select.js';
import { blockDemoWrite } from '../demo/demo-gate.js';
import type { MachineRow, ModelOption } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { MACHINES_HREF } from '../resources/machines-page.js';
import { PROVIDERS_HREF } from '../resources/providers-page.js';
import { AgentModelSelect, AgentRuntimeSelect } from './agent-model-select.js';

const CONTROL_CLS = cn('w-full', FORM_CONTROL_CLS);

const NOTICE_CLS = cn(
  'flex items-center gap-2 bg-card px-3 py-2 text-ui text-content-secondary ring-1 ring-border',
  CARD_RADIUS_CLS,
);
const NOTICE_LINK_CLS = 'ml-auto text-(--card-button) no-underline hover:underline';

export interface CreateAgentInput {
  displayName: string;
  provider?: string | null;
  modelId?: string | null;
  machineId: string;
}

interface CreateAgentDialogProps {
  open?: boolean;
  onClose: () => void;
  onCreate?: (input: CreateAgentInput) => void;
  modelOptions?: ModelOption[];
  machines?: MachineRow[];
  defaultMachineId?: string;
}

export function CreateAgentDialog({
  open,
  onClose,
  onCreate,
  modelOptions = [],
  machines = [],
  defaultMachineId,
}: CreateAgentDialogProps) {
  const { t } = useI18n();
  const { search } = useLocation();
  const [name, setName] = useState('');
  const [provider, setProvider] = useState<string | null>(null);
  const [machineId, setMachineId] = useState<string | null>(defaultMachineId ?? null);
  const [modelId, setModelId] = useState<string | null>(null);
  const runtime = provider === 'claude-code' ? 'claude-code' : 'pi';
  const machineCandidates = machines.filter((m) => (m.enabledRuntimes ?? []).includes(runtime));
  const machineModelOptions =
    provider === 'claude-code'
      ? machineId === null
        ? []
        : modelOptions.filter((o) => o.machineId === machineId)
      : modelOptions;
  const submit = () => {
    const displayName = name.trim();
    if (displayName === '' || machineId === null) return;
    if (blockDemoWrite()) {
      onClose();
      return;
    }
    if (onCreate != null) {
      onCreate({ displayName, provider, modelId, machineId });
    } else {
      onClose();
    }
    setName('');
    setProvider(null);
    setMachineId(defaultMachineId ?? null);
    setModelId(null);
  };
  return (
    <DialogShell
      title={t('创建 agent')}
      open={open}
      onClose={onClose}
      size="m"
      footer={
        <FormActions
          className="pt-0"
          secondary={{ label: t('取消'), onClick: onClose }}
          primary={{
            label: t('创建'),
            disabled: name.trim() === '' || machineId === null,
            onClick: submit,
          }}
        />
      }
    >
      <FormStack>
        <div className="flex items-center" data-testid="agent-avatar">
          <SeededAvatar name={name.trim()} fallback="/avatar-robot-1.svg" className="size-10" />
        </div>
        <FormField label={t('名称')} htmlFor="dlg-agent-name">
          <Input
            id="dlg-agent-name"
            className={FORM_CONTROL_CLS}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('输入 Agent 名称')}
          />
        </FormField>
        {machines.length === 0 ? (
          <div className={NOTICE_CLS}>
            <span>{t('还没有接入机器')}</span>
            <Link className={NOTICE_LINK_CLS} to={{ pathname: MACHINES_HREF, search }}>
              {t('接入机器')}
            </Link>
          </div>
        ) : (
          <>
            <FormField label={t('运行时')} htmlFor="dlg-agent-runtime">
              <AgentRuntimeSelect
                id="dlg-agent-runtime"
                value={provider}
                options={modelOptions}
                onPick={(next) => {
                  if (next !== provider) {
                    setModelId(null);
                    if (defaultMachineId === undefined) setMachineId(null);
                  }
                  setProvider(next);
                }}
                prefix="dlg-agent-runtime"
                triggerClassName={CONTROL_CLS}
              />
            </FormField>
            <FormField label={t('归属机')} htmlFor="dlg-agent-machine">
              <Select
                value={machineId}
                onValueChange={(next) => {
                  if (next !== machineId) setModelId(null);
                  setMachineId(next as string | null);
                }}
              >
                <SelectTrigger
                  id="dlg-agent-machine"
                  className={cn('dlg-agent-machine-select', CONTROL_CLS)}
                >
                  <SelectValue>
                    {machineCandidates.find((m) => m.id === machineId)?.name ?? t('选择机器')}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent aria-label={t('归属机')}>
                  {machineCandidates.map((m) => (
                    <SelectItem key={m.id} className="dlg-agent-machine-row" value={m.id ?? ''}>
                      {m.name}
                      {m.online === false ? `（${t('离线')}）` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            {modelOptions.length > 0 ? (
              <FormField label={t('模型')} htmlFor="dlg-agent-model">
                <AgentModelSelect
                  id="dlg-agent-model"
                  provider={provider}
                  modelId={modelId}
                  options={machineModelOptions}
                  disabled={provider === 'claude-code' && machineId === null}
                  onPick={setModelId}
                  prefix="dlg-agent-model"
                  triggerClassName={CONTROL_CLS}
                />
              </FormField>
            ) : (
              <div className={NOTICE_CLS}>
                <span>{t('尚未配置模型服务商')}</span>
                <Link className={NOTICE_LINK_CLS} to={{ pathname: PROVIDERS_HREF, search }}>
                  {t('配置服务商')}
                </Link>
              </div>
            )}
          </>
        )}
      </FormStack>
    </DialogShell>
  );
}
