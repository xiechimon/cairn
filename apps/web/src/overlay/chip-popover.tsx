import { useAgentAvatarUrlById, useLiveData } from '../api/provider.js';
import { Button } from '../components/ui/button.js';
import { SeededAvatar } from '../components/ui/seeded-avatar.js';
import { AGENT_MODEL_LINE, PROJECT_NAME } from '../fixtures/fixtures.js';
import type { TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { Check, Settings } from '../icons/index.js';

const POPOVER_ROW =
  'flex min-h-8 items-center gap-2.5 rounded-md px-1.5 text-sm leading-5 text-(--text-tertiary) transition-[background-color] duration-150 hover:bg-(--accent-soft) [&_img]:size-3 [&_img]:flex-none [&_img]:rounded-full';

const SECTION_LABEL = 'px-1.5 text-xs leading-4 font-medium text-muted-foreground';

export function ChipPopover({ todo, projectName, agentModel, onEditAssign }: ChipPopoverProps) {
  const { t } = useI18n();
  const { user, live } = useLiveData();
  const project = live ? projectName : PROJECT_NAME;
  const modelLine = live
    ? agentModel && `${agentModel.modelId} · ${agentModel.thinkingLevel ?? t('默认')}`
    : AGENT_MODEL_LINE;
  const agentAvatarUrl = useAgentAvatarUrlById();
  return (
    <div className="chip-popover flex flex-col gap-1.5 text-left">
      <div className="flex items-center gap-2 px-1.5">
        {project !== undefined && (
          <>
            <span className="flex size-3 flex-none items-center justify-center rounded-[4px] bg-(--project-avatar-bg) text-[8px] font-medium text-(--project-avatar-fg)">
              {project.charAt(0).toLowerCase()}
            </span>
            <span className="text-xs leading-4 text-(--text-tertiary)">{project}</span>
          </>
        )}
        <span className="text-xs leading-4 text-(--text-tertiary)">#{todo.seqNum}</span>
      </div>
      <div className="px-1.5 text-sm leading-5 text-(--foreground)">{todo.title}</div>
      <div className="h-px flex-none bg-(--border)" />
      <div className="flex flex-none flex-col gap-0.5">
        <div className={SECTION_LABEL}>{t('任务')}</div>
        <div className={POPOVER_ROW} data-row-kind="owner">
          <SeededAvatar
            className="size-3"
            name={user.displayName}
            src={user.avatarUrl}
            fallback="/avatar-user.png"
          />
          {user.displayName}
        </div>
      </div>
      <div
        className="flex flex-none flex-col gap-0.5 rounded-md bg-(--spot-soft) px-1 py-1"
        data-selected=""
      >
        <div className={SECTION_LABEL}>{t('执行对话')}</div>
        <div className={POPOVER_ROW} data-row-kind="agent">
          <SeededAvatar
            className="size-3"
            name={todo.agent?.displayName}
            src={todo.agent ? (agentAvatarUrl.get(todo.agent.id) ?? null) : null}
            fallback="/avatar-robot-1.svg"
          />
          {todo.agent?.displayName ?? t('未指派')}
          {modelLine !== undefined && ` · ${modelLine}`}
          <span className="ml-auto flex text-(--card-button)">
            <Check width={14} height={14} />
          </span>
        </div>
      </div>
      <div className="h-px flex-none bg-(--border)" />
      <Button
        variant="ghost"
        size="default"
        className="min-h-8 flex-none cursor-pointer justify-start gap-2 rounded-md border-none bg-transparent px-1.5 text-left text-sm leading-5 font-normal whitespace-normal text-(--text-tertiary) hover:bg-transparent hover:text-(--text-tertiary) dark:hover:bg-transparent dark:hover:text-(--text-tertiary) aria-expanded:bg-transparent aria-expanded:text-(--text-tertiary) active:not-aria-[haspopup]:translate-y-0 [&_svg:not([class*='size-'])]:size-auto"
        onClick={onEditAssign}
      >
        <Settings width={14} height={14} />
        {t('编辑分配')}
      </Button>
    </div>
  );
}

export interface ChipAgentModel {
  modelId: string;
  thinkingLevel: string | null;
}

interface ChipPopoverProps {
  todo: TodoRecord;
  projectName?: string;
  agentModel?: ChipAgentModel;
  onEditAssign?: () => void;
}
