import { MCP_TOOL_REGISTRY } from '@cairn/shared';
import { useState } from 'react';
import { FORM_CONTROL_CLS, FormActions, FormField, FormStack } from '../components/form-layout.js';
import { Button } from '../components/ui/button.js';
import { Checkbox } from '../components/ui/checkbox.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import { useI18n } from '../i18n/provider.js';

const READ_TOOLS = MCP_TOOL_REGISTRY.filter((tool) => tool.kind === 'read');
const WRITE_TOOLS = MCP_TOOL_REGISTRY.filter((tool) => tool.kind === 'write');
const READ_GRANTS: readonly string[] = READ_TOOLS.map((tool) => tool.grant);
const WRITE_GRANTS: readonly string[] = WRITE_TOOLS.map((tool) => tool.grant);

const TOOL_LABELS: Record<(typeof MCP_TOOL_REGISTRY)[number]['grant'], string> = {
  Todos: '任务',
  Projects: '项目',
  Conversation: '对话',
  Schedules: '定时',
  Attachment: '附件',
  Skills: '技能',
  Machines: '执行机',
  Issues: 'Issue',
  'Pull Requests': 'PR',
  'Workflow Runs': '工作流运行',
  'Threads Waiting on Me': '等我处理的线程',
  'Read Thread': '查看线程',
  'Thread Pull Requests': '线程的 PR',
  'Wait Thread': '等待线程完成',
  'Search Threads': '搜索线程',
  'Create Todo': '新建任务',
  'Update Todo': '修改任务',
  'Message Todo': '给任务发消息',
  'Confirm Builds': '确认运行',
  'Merge Builds': '合并运行结果',
  'Cancel Builds': '取消运行',
  'Complete Todos': '完成任务',
  'Close Todos': '关闭任务',
  'Reopen Todos': '重新打开任务',
  'Schedule Todo': '设置定时',
  'Unschedule Todo': '取消定时',
  'Start Thread': '新建线程',
  'Reply Thread': '回复线程',
  'Interrupt Thread': '中断线程',
};

const OPTION_ROW_CLS =
  'flex cursor-pointer items-center gap-2 py-1 text-ui text-foreground pointer-coarse:min-h-11';

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
    setRead(new Set(READ_GRANTS));
    setWrite(new Set(WRITE_GRANTS));
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
      toolGrants: {
        read: [...read].filter((grant) => READ_GRANTS.includes(grant)),
        write: [...write].filter((grant) => WRITE_GRANTS.includes(grant)),
      },
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
        <div className="flex flex-col">
          <label htmlFor="apikey-git-access" className={OPTION_ROW_CLS}>
            <Checkbox id="apikey-git-access" checked={gitAccess} onCheckedChange={setGitAccess} />
            {t('Git 读写（托管仓库推送与拉取）')}
          </label>
          <label htmlFor="apikey-mcp-access" className={OPTION_ROW_CLS}>
            <Checkbox id="apikey-mcp-access" checked={mcpAccess} onCheckedChange={setMcpAccess} />
            {t('MCP 访问（MCP 客户端接入）')}
          </label>
          <label htmlFor="apikey-machine-access" className={OPTION_ROW_CLS}>
            <Checkbox
              id="apikey-machine-access"
              checked={machineAccess}
              onCheckedChange={setMachineAccess}
            />
            {t('注册执行机（命令行接入）')}
          </label>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-ui font-medium text-foreground">{t('工具权限')}</span>
          <span className="-mr-2 flex gap-2">
            <Button variant="ghost" size="xs" className="pointer-coarse:h-11" onClick={grantAll}>
              {t('授予全部')}
            </Button>
            <Button variant="ghost" size="xs" className="pointer-coarse:h-11" onClick={clearAll}>
              {t('清空')}
            </Button>
          </span>
        </div>
        <div className="flex flex-col gap-2 rounded-md border border-border bg-card px-3 py-2 dark:bg-input/30">
          {(
            [
              {
                heading: t('读取'),
                tools: READ_TOOLS,
                picked: read,
                setPicked: setRead,
              },
              {
                heading: t('写入'),
                tools: WRITE_TOOLS,
                picked: write,
                setPicked: setWrite,
              },
            ] as const
          ).map(({ heading, tools, picked, setPicked }) => (
            <fieldset key={heading} className="min-w-0">
              <legend className="py-1 text-meta text-content-tertiary">{heading}</legend>
              <div className="grid grid-cols-2 gap-x-3">
                {tools.map(({ grant, name: id }) => (
                  <label key={grant} htmlFor={`apikey-tool-${id}`} className={OPTION_ROW_CLS}>
                    <Checkbox
                      id={`apikey-tool-${id}`}
                      className="scroll-my-2"
                      checked={picked.has(grant)}
                      onCheckedChange={() => setPicked((set) => toggle(set, grant))}
                    />
                    <span className="min-w-0 truncate">{t(TOOL_LABELS[grant])}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      </FormStack>
    </DialogShell>
  );
}
