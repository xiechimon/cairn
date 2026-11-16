import { MCP_TOOL_REGISTRY } from '@cairn/shared';
import { useState } from 'react';
import { FORM_CONTROL_CLS, FormActions, FormField, FormStack } from '../components/form-layout.js';
import { SegmentedRadio } from '../components/segmented.js';
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
  Issues: 'issue',
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

type KeyAccess = Omit<ApiKeyCreateBody, 'name'>;

export const API_KEY_PRESETS = {
  machine: {
    gitAccess: false,
    mcpAccess: false,
    machineAccess: true,
    toolGrants: { read: [], write: [] },
  },
  read: {
    gitAccess: false,
    mcpAccess: true,
    machineAccess: false,
    toolGrants: { read: [...READ_GRANTS], write: [] },
  },
  all: {
    gitAccess: true,
    mcpAccess: true,
    machineAccess: true,
    toolGrants: { read: [...READ_GRANTS], write: [...WRITE_GRANTS] },
  },
} satisfies Record<string, KeyAccess>;

type Usage = keyof typeof API_KEY_PRESETS | 'custom';

const USAGES: readonly Usage[] = ['machine', 'read', 'all', 'custom'];

const USAGE_LABELS: Record<Usage, string> = {
  machine: '执行机',
  read: '只读',
  all: '全部',
  custom: '自定义',
};

const USAGE_HINTS: Record<Usage, string> = {
  machine: '只能用来在命令行注册执行机，别的都做不了。',
  read: '让 MCP 客户端查看工作台里的所有内容，不能改动。',
  all: 'MCP 客户端能看能改，也能推拉仓库、注册执行机。',
  custom: '自己挑这把密钥能做的事。',
};

interface ApiKeyCreateDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (body: ApiKeyCreateBody) => void;
}

export function ApiKeyCreateDialog({ open, onClose, onCreate }: ApiKeyCreateDialogProps) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [usage, setUsage] = useState<Usage>('machine');
  const [access, setAccess] = useState<KeyAccess>(API_KEY_PRESETS.machine);

  const chooseUsage = (next: Usage) => {
    setUsage(next);
    if (next !== 'custom') setAccess(API_KEY_PRESETS[next]);
  };
  const toggleTool = (kind: 'read' | 'write', grant: string) =>
    setAccess((current) => {
      const picked = current.toolGrants[kind];
      return {
        ...current,
        toolGrants: {
          ...current.toolGrants,
          [kind]: picked.includes(grant)
            ? picked.filter((item) => item !== grant)
            : [...picked, grant],
        },
      };
    });
  const setSwitch = (key: 'machineAccess' | 'gitAccess' | 'mcpAccess', checked: boolean) =>
    setAccess((current) => {
      const nothingPicked =
        current.toolGrants.read.length === 0 && current.toolGrants.write.length === 0;
      return key === 'mcpAccess' && checked && nothingPicked
        ? { ...current, mcpAccess: true, toolGrants: API_KEY_PRESETS.read.toolGrants }
        : { ...current, [key]: checked };
    });
  const submit = () => {
    onCreate({
      name: name.trim() === '' ? null : name.trim(),
      ...access,
      toolGrants: {
        read: READ_GRANTS.filter((grant) => access.toolGrants.read.includes(grant)),
        write: WRITE_GRANTS.filter((grant) => access.toolGrants.write.includes(grant)),
      },
    });
    onClose();
  };
  const switches = [
    { id: 'machine', key: 'machineAccess', label: t('注册执行机（命令行接入）') },
    { id: 'git', key: 'gitAccess', label: t('Git 读写（托管仓库推送与拉取）') },
    { id: 'mcp', key: 'mcpAccess', label: t('MCP 访问') },
  ] as const;

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
            value={usage}
            onChange={chooseUsage}
            options={USAGES.map((option) => ({ value: option, label: t(USAGE_LABELS[option]) }))}
            className="grid h-auto w-full grid-cols-4 dark:[--seg-active:color-mix(in_oklch,var(--popover),white_10%)] [&_button]:w-full [&_button]:px-2 pointer-coarse:[&_button]:h-11"
          />
          <p
            data-testid="apikey-usage-hint"
            className="m-0 text-meta text-balance text-content-secondary"
          >
            {t(USAGE_HINTS[usage])}
          </p>
        </div>
        {usage === 'custom' && (
          <>
            <div className="flex flex-col">
              {switches.map(({ id, key, label }) => (
                <label key={id} htmlFor={`apikey-${id}-access`} className={OPTION_ROW_CLS}>
                  <Checkbox
                    id={`apikey-${id}-access`}
                    checked={access[key]}
                    onCheckedChange={(checked) => setSwitch(key, checked)}
                  />
                  {label}
                </label>
              ))}
            </div>
            {access.mcpAccess && (
              <div className="flex flex-col gap-2 rounded-md border border-border bg-card px-3 py-2 dark:bg-input/30">
                <span className="text-ui font-medium text-foreground">{t('MCP 工具')}</span>
                {(
                  [
                    { kind: 'read', heading: t('读取'), tools: READ_TOOLS },
                    { kind: 'write', heading: t('写入'), tools: WRITE_TOOLS },
                  ] as const
                ).map(({ kind, heading, tools }) => (
                  <fieldset key={kind} className="min-w-0">
                    <legend className="py-1 text-meta text-content-tertiary">{heading}</legend>
                    <div className="grid grid-cols-2 gap-x-3">
                      {tools.map(({ grant, name: id }) => (
                        <label key={grant} htmlFor={`apikey-tool-${id}`} className={OPTION_ROW_CLS}>
                          <Checkbox
                            id={`apikey-tool-${id}`}
                            className="scroll-my-2"
                            checked={access.toolGrants[kind].includes(grant)}
                            onCheckedChange={() => toggleTool(kind, grant)}
                          />
                          <span className="min-w-0 truncate">{t(TOOL_LABELS[grant])}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}
              </div>
            )}
          </>
        )}
      </FormStack>
    </DialogShell>
  );
}
