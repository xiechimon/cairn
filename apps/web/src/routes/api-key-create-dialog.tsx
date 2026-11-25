import { KEY_NAME_PATTERN, MCP_TOOL_REGISTRY } from '@cairn/shared';
import { useState } from 'react';
import { FORM_CONTROL_CLS, FormActions, FormField, FormStack } from '../components/form-layout.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import { useI18n } from '../i18n/provider.js';

export interface ApiKeyCreateBody {
  name: string;
  gitAccess: boolean;
  mcpAccess: boolean;
  machineAccess: boolean;
  toolGrants: { read: string[]; write: string[] };
}

export const API_KEY_ACCESS: Omit<ApiKeyCreateBody, 'name'> = {
  gitAccess: true,
  mcpAccess: true,
  machineAccess: true,
  toolGrants: {
    read: MCP_TOOL_REGISTRY.filter((tool) => tool.kind === 'read').map((tool) => tool.grant),
    write: MCP_TOOL_REGISTRY.filter((tool) => tool.kind === 'write').map((tool) => tool.grant),
  },
};

interface ApiKeyCreateDialogProps {
  open: boolean;
  pending?: boolean;
  onClose: () => void;
  onCreate: (body: ApiKeyCreateBody, onDone: () => void) => void;
}

export function ApiKeyCreateDialog({
  open,
  pending = false,
  onClose,
  onCreate,
}: ApiKeyCreateDialogProps) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const trimmed = name.trim();
  const badName = trimmed !== '' && !KEY_NAME_PATTERN.test(trimmed);
  const ready = trimmed !== '' && !badName;
  const close = () => {
    if (pending) return;
    setName('');
    onClose();
  };
  const submit = () => {
    if (!ready || pending) return;
    onCreate({ name: trimmed, ...API_KEY_ACCESS }, () => {
      setName('');
      onClose();
    });
  };

  return (
    <DialogShell
      title={t('新建 API 密钥')}
      open={open}
      onClose={close}
      size="s"
      footer={
        <FormActions
          className="pt-0"
          primary={{
            label: pending ? t('正在创建…') : t('创建'),
            onClick: submit,
            disabled: !ready || pending,
          }}
          secondary={{ label: t('取消'), onClick: close, disabled: pending }}
        />
      }
    >
      <FormStack className="max-w-none">
        <FormField
          label={t('名称')}
          htmlFor="apikey-name-input"
          help={
            <span
              id="apikey-name-rule"
              role={badName ? 'alert' : undefined}
              className={badName ? 'text-destructive' : undefined}
            >
              {t('只能用大写字母、数字和下划线，不能以数字开头。')}
            </span>
          }
        >
          <Input
            id="apikey-name-input"
            className={`${FORM_CONTROL_CLS} font-mono`}
            value={name}
            aria-invalid={badName}
            aria-describedby="apikey-name-rule"
            autoCapitalize="characters"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) submit();
            }}
            placeholder="MY_KEY"
          />
        </FormField>
      </FormStack>
    </DialogShell>
  );
}
