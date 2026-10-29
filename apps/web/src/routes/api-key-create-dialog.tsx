import { CHIEF_REMOTE_TOOLS } from '@cairn/shared';
import { useState } from 'react';
import { FORM_CONTROL_CLS, FormActions, FormField, FormStack } from '../components/form-layout.js';
import { Button } from '../components/ui/button.js';
import { Checkbox } from '../components/ui/checkbox.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import { useI18n } from '../i18n/provider.js';

const TOOL_NAMES = CHIEF_REMOTE_TOOLS.map((tool) => tool.name);

export interface ApiKeyCreateBody {
  name: string | null;
  gitAccess: boolean;
  mcpAccess: boolean;
  machineAccess: boolean;
  toolGrants: { read: string[]; write: string[] };
}

interface ApiKeyCreateDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (body: ApiKeyCreateBody) => void;
}

export function ApiKeyCreateDialog({ open, onClose, onCreate }: ApiKeyCreateDialogProps) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [gitAccess, setGitAccess] = useState(false);
  const [mcpAccess, setMcpAccess] = useState(false);
  const [machineAccess, setMachineAccess] = useState(true);
  const [read, setRead] = useState<Set<string>>(new Set());
  const [write, setWrite] = useState<Set<string>>(new Set());

  const toggle = (set: Set<string>, tool: string): Set<string> => {
    const next = new Set(set);
    if (next.has(tool)) next.delete(tool);
    else next.add(tool);
    return next;
  };
  const grantAll = () => {
    setRead(new Set(TOOL_NAMES));
    setWrite(new Set(TOOL_NAMES));
    setGitAccess(true);
    setMcpAccess(true);
    setMachineAccess(true);
  };
  const clearAll = () => {
    setRead(new Set());
    setWrite(new Set());
    setGitAccess(false);
    setMcpAccess(false);
    setMachineAccess(false);
  };
  const submit = () => {
    onCreate({
      name: name.trim() === '' ? null : name.trim(),
      gitAccess,
      mcpAccess,
      machineAccess,
      toolGrants: { read: [...read], write: [...write] },
    });
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
        <div className="flex flex-col gap-1.5">
          {/* biome-ignore lint/a11y/noLabelWithoutControl: Base UI Checkbox.Root renders its hidden native input inside this label at runtime; the static check cannot see through the component. */}
          <label className="inline-flex cursor-pointer items-center gap-2 text-ui text-content-secondary">
            <Checkbox
              checked={gitAccess}
              onCheckedChange={setGitAccess}
              aria-label={t('Git 读写（托管仓库 push/pull）')}
            />
            {t('Git 读写（托管仓库 push/pull）')}
          </label>
          {/* biome-ignore lint/a11y/noLabelWithoutControl: Base UI Checkbox.Root renders its hidden native input inside this label at runtime; the static check cannot see through the component. */}
          <label className="inline-flex cursor-pointer items-center gap-2 text-ui text-content-secondary">
            <Checkbox
              checked={mcpAccess}
              onCheckedChange={setMcpAccess}
              aria-label={t('MCP 访问（MCP 客户端接入）')}
            />
            {t('MCP 访问（MCP 客户端接入）')}
          </label>
          <div className="inline-flex items-center gap-2 text-ui text-content-secondary">
            <Checkbox
              checked={machineAccess}
              onCheckedChange={setMachineAccess}
              aria-label={t('机器注册（CLI 接入执行机）')}
            />
            <span>{t('机器注册（CLI 接入执行机）')}</span>
          </div>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-ui font-medium text-foreground">{t('工具权限位')}</span>
          <span className="flex gap-2">
            <Button variant="ghost" size="xs" onClick={grantAll}>
              {t('授予全部')}
            </Button>
            <Button variant="ghost" size="xs" onClick={clearAll}>
              {t('清空')}
            </Button>
          </span>
        </div>
        <div className="max-h-66 scroll-py-2 overflow-y-auto rounded-md border border-border bg-card px-2 py-1 dark:bg-input/30">
          <div className="flex items-center gap-2 py-1 text-meta text-content-tertiary">
            <span className="flex-1" />
            <span className="w-8 text-center">{t('读')}</span>
            <span className="w-8 text-center">{t('写')}</span>
          </div>
          {TOOL_NAMES.map((tool) => (
            <div key={tool} className="flex items-center gap-2 py-1 text-meta">
              <span className="flex-1 text-content-secondary">{tool}</span>
              <span className="w-8 text-center text-content-tertiary">
                <Checkbox
                  checked={read.has(tool)}
                  onCheckedChange={() => setRead((set) => toggle(set, tool))}
                  aria-label={`${t('读')} ${tool}`}
                />
              </span>
              <span className="w-8 text-center text-content-tertiary">
                <Checkbox
                  checked={write.has(tool)}
                  onCheckedChange={() => setWrite((set) => toggle(set, tool))}
                  aria-label={`${t('写')} ${tool}`}
                />
              </span>
            </div>
          ))}
        </div>
      </FormStack>
    </DialogShell>
  );
}
