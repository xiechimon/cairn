import { useEffect, useRef, useState } from 'react';
import { ProjectAvatar } from '../board/project-avatar.js';
import { useProjectMark } from '../board/project-mark.js';
import { AgentPicker, type AgentPickerOption } from '../components/agent-picker.js';
import { Button } from '../components/ui/button.js';
import { SeededAvatar } from '../components/ui/seeded-avatar.js';
import { TagChip, type TagChipData } from '../components/ui/tag-chip.js';
import { Textarea } from '../components/ui/textarea.js';
import type { TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';
import { ChevronDown, Monitor } from '../icons/index.js';
import { SpecBlock } from './spec-block.js';

const SAVE_DELAY_MS = 800;

export function formatCreatedAt(ms: number, t: TFunc): string {
  const base = {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  } as const;
  const parts = new Intl.DateTimeFormat('zh-CN', {
    ...base,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).formatToParts(ms);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const monthShort =
    new Intl.DateTimeFormat('en-US', { ...base, month: 'short' })
      .formatToParts(ms)
      .find((p) => p.type === 'month')?.value ?? '';
  return t('{y}年{mo}月{d}日 {hh}:{mm} 创建', {
    y: get('year'),
    mo: get('month'),
    d: get('day'),
    hh: get('hour'),
    mm: get('minute'),
    monthShort,
  });
}

const CHIP =
  'inline-flex h-7 max-w-full items-center gap-1.5 rounded-lg bg-card px-2 text-ui text-content-secondary shadow-[inset_0_0_0_1px_var(--border)]';

interface FreshBlockProps {
  todo: TodoRecord;
  projectName?: string;
  tags?: TagChipData[];
  machineName?: string | null;
  agentOptions?: AgentPickerOption[];
  agentAvatarUrl?: string | null;
  onPickAgent?: (agentId: string) => void;
  agentRebindCopy?: string;
  spec: string;
  onSaveSpec?: (spec: string) => Promise<unknown> | void;
  action?: string | null;
  onAction?: () => void;
  actionInFlight?: boolean;
}

function DescriptionBox({
  spec,
  onSave,
}: {
  spec: string;
  onSave?: (spec: string) => Promise<unknown> | void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(spec);
  const [focused, setFocused] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const base = useRef(spec);
  const inFlight = useRef(false);
  const save = useRef(onSave);
  save.current = onSave;
  const dirty = draft !== base.current;

  const seen = useRef(spec);
  useEffect(() => {
    if (spec === seen.current) return;
    seen.current = spec;
    if (!saving && !failed && draft === base.current) {
      base.current = spec;
      setDraft(spec);
    }
  }, [spec, saving, failed, draft]);

  const commit = async () => {
    const value = draft;
    if (value === base.current || inFlight.current || save.current == null) return;
    inFlight.current = true;
    setSaving(true);
    setFailed(false);
    try {
      await save.current(value);
      base.current = value;
    } catch {
      setFailed(true);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  useEffect(() => {
    if (draft === base.current || saving || failed) return;
    const timer = setTimeout(() => void commit(), SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  });

  const flush = () => {
    setFocused(false);
    void commit();
  };

  if (draft.trim() !== '' && !focused && !dirty && !saving && !failed) {
    return (
      <div data-testid="fresh-description-view">
        <SpecBlock spec={draft} className="m-0" />
        {onSave != null && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-1 h-6 px-1.5 text-meta font-normal text-content-tertiary"
            onClick={() => setFocused(true)}
          >
            {t('编辑描述')}
          </Button>
        )}
      </div>
    );
  }

  const field = (
    <Textarea
      data-testid="fresh-description"
      autoFocus={focused}
      className="min-h-28 rounded-lg border-none bg-card px-3 py-2.5 text-card-title leading-6 text-foreground shadow-[inset_0_0_0_1px_var(--border)] placeholder:text-content-tertiary md:text-card-title dark:bg-card"
      value={draft}
      readOnly={onSave == null}
      aria-label={t('描述')}
      placeholder={t('补充 Agent 需要知道的内容：设置放在哪里、做到什么程度算完成…')}
      onChange={(event) => {
        setFailed(false);
        setDraft(event.target.value);
      }}
      onFocus={() => setFocused(true)}
      onBlur={flush}
    />
  );

  return (
    <>
      {field}
      {failed && (
        <div
          role="alert"
          data-testid="fresh-description-error"
          className="mt-1.5 flex items-center gap-2 text-meta text-destructive"
        >
          {t('描述未能保存，内容仍保留在这里。')}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-meta font-normal"
            onClick={() => void commit()}
          >
            {t('重试')}
          </Button>
        </div>
      )}
    </>
  );
}

export function FreshBlock({
  todo,
  projectName,
  tags,
  machineName,
  agentOptions,
  agentAvatarUrl,
  onPickAgent,
  agentRebindCopy,
  spec,
  onSaveSpec,
  action,
  onAction,
  actionInFlight,
}: FreshBlockProps) {
  const { t } = useI18n();
  const projectMark = useProjectMark();
  const agentName = todo.agent?.displayName ?? null;
  const selected = agentOptions?.find((option) => option.id === todo.agent?.id);
  return (
    <div
      className="fresh-block mx-auto w-[calc(100%-2rem)] max-w-(--chat-max-w) pt-18"
      data-testid="fresh-block"
    >
      <h2 className="fresh-title m-0 mb-3 font-serif text-page font-semibold break-words text-(--foreground)">
        {todo.title}
      </h2>
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {projectName !== undefined && (
          <span className={CHIP} data-testid="fresh-project">
            <ProjectAvatar name={projectName} {...projectMark(projectName)} bare />
            <span className="font-medium text-foreground">{projectName}</span>
          </span>
        )}
        {(agentName != null || agentOptions != null) && (
          <AgentPicker
            agents={agentOptions ?? []}
            selectedId={todo.agent?.id ?? null}
            onSelect={onPickAgent}
            rebindCopy={agentRebindCopy}
            align="start"
            footnote={t('开始前更换 Agent，不会丢失任何内容。')}
            trigger={
              <Button
                variant="ghost"
                data-testid="fresh-agent-chip"
                aria-label={t('执行 Agent')}
                className={`${CHIP} h-7 cursor-pointer font-normal hover:bg-card aria-expanded:bg-(--menu-hover)`}
              />
            }
          >
            <SeededAvatar
              className="size-4.5"
              name={agentName ?? undefined}
              src={agentAvatarUrl ?? null}
              fallback="/avatar-robot-1.svg"
            />
            <span className="font-medium text-foreground">{agentName ?? t('未指派')}</span>
            {selected?.summary != null && <span>{selected.summary}</span>}
            <ChevronDown width={12} height={12} className="flex-none text-content-tertiary" />
          </AgentPicker>
        )}
        {machineName != null && (
          <span className={CHIP} data-testid="fresh-machine">
            <Monitor width={14} height={14} className="flex-none text-content-tertiary" />
            <span className="font-medium text-foreground">{machineName}</span>
          </span>
        )}
        {(tags ?? []).map((tag) => (
          <TagChip key={tag.id} tag={tag} className="fresh-tag-chip" />
        ))}
      </div>
      <DescriptionBox spec={spec} onSave={onSaveSpec} />
      {action != null && onAction != null && (
        <div className="mt-5 flex items-center gap-3">
          {actionInFlight === true ? (
            <Button className="fresh-start" data-orchestrating="true" disabled>
              {t('编排中')}
            </Button>
          ) : (
            <Button className="fresh-start" onClick={onAction}>
              {t(action)}
            </Button>
          )}
          {action === '开始' && (
            <span className="text-meta text-(--text-tertiary)" data-testid="fresh-start-note">
              {agentName != null
                ? t('{agent} 会先写方案，你确认之前不会改动任何东西。', { agent: agentName })
                : t('Agent 会先写方案，你确认之前不会改动任何东西。')}
            </span>
          )}
        </div>
      )}
      <div className="mt-8 text-meta text-(--text-tertiary)">
        {formatCreatedAt(todo.phaseAt, t)}
      </div>
    </div>
  );
}
