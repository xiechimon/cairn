import { MCP_TOOL_REGISTRY } from '@cairn/shared';
import { useState } from 'react';
import { FORM_CONTROL_CLS, FormActions, FormField, FormStack } from '../components/form-layout.js';
import { SegmentedRadio } from '../components/segmented.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import { useI18n } from '../i18n/provider.js';

export interface ApiKeyCreateBody {
  name: string | null;
  gitAccess: boolean;
  mcpAccess: boolean;
  machineAccess: boolean;
  toolGrants: { read: string[]; write: string[] };
}

export const API_KEY_USES = {
  machine: {
    gitAccess: false,
    mcpAccess: false,
    machineAccess: true,
    toolGrants: { read: [], write: [] },
  },
  mcp: {
    gitAccess: true,
    mcpAccess: true,
    machineAccess: false,
    toolGrants: {
      read: MCP_TOOL_REGISTRY.filter((tool) => tool.kind === 'read').map((tool) => tool.grant),
      write: MCP_TOOL_REGISTRY.filter((tool) => tool.kind === 'write').map((tool) => tool.grant),
    },
  },
} satisfies Record<string, Omit<ApiKeyCreateBody, 'name'>>;

type Use = keyof typeof API_KEY_USES;

const USE_TEXT: Record<Use, { label: string; hint: string }> = {
  machine: {
    label: '执行机',
    hint: '只能在其他电脑上用 cairn start 注册执行机。',
  },
  mcp: {
    label: 'MCP 客户端',
    hint: '让 Claude Code、Cursor 等客户端查看和操作工作台。',
  },
};

interface ApiKeyCreateDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (body: ApiKeyCreateBody) => void;
}

export function ApiKeyCreateDialog({ open, onClose, onCreate }: ApiKeyCreateDialogProps) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [use, setUse] = useState<Use>('machine');
  const submit = () => {
    onCreate({ name: name.trim() === '' ? null : name.trim(), ...API_KEY_USES[use] });
    onClose();
  };

  return (
    <DialogShell
      title={t('新建密钥')}
      open={open}
      onClose={onClose}
      size="s"
      footer={
        <FormActions
          className="pt-0"
          primary={{ label: t('创建'), onClick: submit }}
          secondary={{ label: t('取消'), onClick: onClose }}
        />
      }
    >
      <FormStack className="max-w-none">
        <FormField label={t('名称（可选）')} htmlFor="apikey-name-input">
          <Input
            id="apikey-name-input"
            className={FORM_CONTROL_CLS}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('如：笔记本、CI 机器')}
          />
        </FormField>
        <div className="flex flex-col gap-2">
          <span className="text-ui font-medium text-foreground">{t('用途')}</span>
          <SegmentedRadio
            label={t('用途')}
            value={use}
            onChange={setUse}
            options={(['machine', 'mcp'] as const).map((value) => ({
              value,
              label: t(USE_TEXT[value].label),
            }))}
            className="grid h-auto w-full grid-cols-2 dark:[--seg-active:color-mix(in_oklch,var(--popover),white_10%)] [&_button]:w-full [&_button]:px-2 pointer-coarse:[&_button]:h-11"
          />
          <p
            data-testid="apikey-usage-hint"
            className="m-0 text-meta text-balance text-content-secondary"
          >
            {t(USE_TEXT[use].hint)}
          </p>
        </div>
      </FormStack>
    </DialogShell>
  );
}
