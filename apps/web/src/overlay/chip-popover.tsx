import { useAgentAvatarUrlById, useLiveData } from '../api/provider.js';
import { ProjectAvatar } from '../board/project-avatar.js';
import { Button } from '../components/ui/button.js';
import { SeededAvatar } from '../components/ui/seeded-avatar.js';
import { AGENT_MODEL, PROJECT_NAME } from '../fixtures/fixtures.js';
import type { TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { Settings } from '../icons/index.js';

const ROW = 'grid grid-cols-[5.5rem_1fr] items-center gap-2 px-1.5 py-1';
const ROW_LABEL = 'text-meta text-content-tertiary';
const ROW_VALUE = 'flex min-w-0 items-center gap-2 text-ui text-foreground';

export function ChipPopover({ todo, projectName, agentModel, onEditAssign }: ChipPopoverProps) {
  const { t } = useI18n();
  const { user, live } = useLiveData();
  const project = live ? projectName : PROJECT_NAME;
  const model = live ? agentModel : AGENT_MODEL;
  const modelLine =
    model && (model.thinkingLevel ? `${model.modelId} · ${model.thinkingLevel}` : model.modelId);
  const agentAvatarUrl = useAgentAvatarUrlById();
  return (
    <div className="chip-popover flex w-72 flex-col gap-1 text-left">
      <div className="flex flex-col gap-1 px-1.5 pt-0.5 pb-1.5">
        <div className="flex items-center gap-1.5 text-meta text-content-tertiary">
          {project !== undefined && (
            <>
              <ProjectAvatar name={project} tone={0} />
              <span className="truncate">{project}</span>
              <span aria-hidden="true">·</span>
            </>
          )}
          <span className="tabular-nums">#{todo.seqNum}</span>
        </div>
        <div className="text-ui leading-5 font-medium text-foreground">{todo.title}</div>
      </div>
      <div className="h-px flex-none bg-(--border)" />
      <div className={ROW} data-row-kind="owner">
        <span className={ROW_LABEL}>{t('负责人')}</span>
        <span className={ROW_VALUE}>
          <SeededAvatar
            className="size-4.5 flex-none"
            name={user.displayName}
            src={user.avatarUrl}
            fallback="/avatar-user.png"
          />
          <span className="truncate">{user.displayName}</span>
        </span>
      </div>
      <div className={ROW} data-row-kind="agent" data-selected="">
        <span className={`${ROW_LABEL} self-start pt-0.5`}>{t('执行对话')}</span>
        <span className="flex min-w-0 items-start gap-2">
          <SeededAvatar
            className="mt-0.5 size-4.5 flex-none"
            name={todo.agent?.displayName}
            src={todo.agent ? (agentAvatarUrl.get(todo.agent.id) ?? null) : null}
            fallback="/avatar-robot-1.svg"
          />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-ui text-foreground">
              {todo.agent?.displayName ?? t('未指派')}
            </span>
            {modelLine !== undefined && (
              <span className="truncate font-mono text-caption text-content-tertiary">
                {modelLine}
              </span>
            )}
          </span>
        </span>
      </div>
      <div className="h-px flex-none bg-(--border)" />
      <Button
        variant="ghost"
        className="h-8 flex-none cursor-pointer justify-start gap-2 rounded-(--radius-menu-item) border-none px-1.5 text-ui font-normal text-content-secondary hover:bg-(--menu-hover) hover:text-foreground dark:hover:bg-(--menu-hover) [&_svg:not([class*='size-'])]:size-auto"
        onClick={onEditAssign}
      >
        <Settings width={15} height={15} className="text-content-tertiary" />
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
