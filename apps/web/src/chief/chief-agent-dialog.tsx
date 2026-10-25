import { CHIEF_REBIND_CONFIRM_COPY, type TeamMember } from '@cairn/shared';
import { useEffect, useMemo, useState } from 'react';
import { SEARCH_BOX_CLS, SEARCH_INPUT_CLASS } from '../components/model-select-core.js';
import { Button } from '../components/ui/button.js';
import {
  DIALOG_PRIMARY_BUTTON,
  DIALOG_TEXT_BUTTON,
  DialogShell,
} from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import { SeededAvatar } from '../components/ui/seeded-avatar.js';
import { useI18n } from '../i18n/provider.js';
import { Check, Search } from '../icons/index.js';

const AGENT_PICK_ROW_CLS =
  "h-10 w-full cursor-pointer justify-start gap-2.5 whitespace-normal rounded-none border-none bg-transparent px-2 text-left text-sm font-normal text-(--foreground) hover:bg-(--secondary) hover:text-(--foreground) dark:hover:bg-(--secondary) aria-expanded:bg-transparent aria-expanded:text-(--foreground) active:not-aria-[haspopup]:translate-y-0 [&_svg:not([class*='size-'])]:size-auto";

const PICK_AVATAR_CLS = 'flex-none [&_img]:block [&_img]:size-6 [&_img]:rounded-full';

export interface ChiefAgentOption {
  id: string;
  name: string;
  model?: string;
  avatarUrl?: string | null;
}

export const UNASSIGNED_AGENT_ID = '';

export function assignOptionsFromMembers(members: readonly TeamMember[]): ChiefAgentOption[] {
  return members
    .filter((m) => m.memberType === 'agent')
    .map((m) => {
      const actor = m.actor as
        | { displayName?: string; modelId?: string | null; avatarUrl?: string | null }
        | undefined;
      return {
        id: m.actorId,
        name: actor?.displayName ?? m.actorId,
        ...(actor?.modelId ? { model: actor.modelId } : {}),
        avatarUrl: actor?.avatarUrl ?? null,
      };
    });
}

const DEFAULT_AGENT: ChiefAgentOption = { id: 'r3-builder', name: 'r3-builder' };

interface ChiefAgentDialogProps {
  open?: boolean;
  onClose: () => void;
  agents?: ChiefAgentOption[];
  boundAgentId?: string | null;
  onBind?: (agentId: string) => void;
  title?: string;
  confirmCopy?: string;
  unassign?: boolean;
  confirmRebind?: boolean;
}

export function ChiefAgentDialog({
  open,
  onClose,
  agents,
  boundAgentId,
  onBind,
  title,
  confirmCopy,
  unassign,
  confirmRebind = true,
}: ChiefAgentDialogProps) {
  const { t } = useI18n();
  const dlgTitle = title ?? t('选择总管 Agent');
  const [query, setQuery] = useState('');
  const [confirming, setConfirming] = useState<ChiefAgentOption | null>(null);
  useEffect(() => {
    if (open) {
      setQuery('');
      setConfirming(null);
    }
  }, [open]);
  const rows = useMemo(() => {
    const source = agents ?? [DEFAULT_AGENT];
    const withUnassign = unassign
      ? [{ id: UNASSIGNED_AGENT_ID, name: t('未指派') }, ...source]
      : source;
    const q = query.trim().toLowerCase();
    return q === ''
      ? withUnassign
      : withUnassign.filter(
          (row) => row.id === UNASSIGNED_AGENT_ID || row.name.toLowerCase().includes(q),
        );
  }, [agents, query, unassign, t]);

  const pick = (row: ChiefAgentOption) => {
    if (row.id === boundAgentId) {
      onClose();
      return;
    }
    if (onBind == null) {
      onClose();
      return;
    }
    if (confirmRebind && boundAgentId != null) {
      setConfirming(row);
      return;
    }
    onBind(row.id);
  };

  return (
    <DialogShell
      title={dlgTitle}
      open={open}
      onClose={onClose}
      size="m"
      footer={
        confirming != null ? (
          <>
            <Button
              variant="ghost"
              className={DIALOG_TEXT_BUTTON}
              onClick={() => setConfirming(null)}
            >
              {t('取消')}
            </Button>
            <Button className={DIALOG_PRIMARY_BUTTON} onClick={() => onBind?.(confirming.id)}>
              {t('更换')}
            </Button>
          </>
        ) : undefined
      }
    >
      {confirming != null ? (
        <div className="flex flex-col gap-4">
          <p className="m-0 text-ui text-foreground">
            {t(confirmCopy ?? CHIEF_REBIND_CONFIRM_COPY).replaceAll('<agent>', confirming.name)}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className={SEARCH_BOX_CLS}>
            <Search width={14} height={14} />
            <Input
              className={SEARCH_INPUT_CLASS}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('搜索 Agent…')}
            />
          </div>
          <div
            className="flex max-h-60 flex-col overflow-y-auto"
            role="listbox"
            aria-label={dlgTitle}
          >
            {rows.length === 0 ? (
              <div className="px-2 py-4 text-center text-ui text-content-tertiary">
                {t('没有匹配的 Agent')}
              </div>
            ) : (
              rows.map((row) => (
                <Button
                  key={row.id}
                  variant="ghost"
                  className={AGENT_PICK_ROW_CLS}
                  role="option"
                  aria-selected={row.id === boundAgentId}
                  onClick={() => pick(row)}
                >
                  <span className={PICK_AVATAR_CLS}>
                    <SeededAvatar
                      className="size-6"
                      name={row.name}
                      src={row.avatarUrl}
                      fallback="/avatar-robot-1.svg"
                    />
                  </span>
                  <span>{row.name}</span>
                  {row.model != null && row.model !== '' && (
                    <span className="text-xs text-(--text-tertiary)">{row.model}</span>
                  )}
                  {row.id === boundAgentId && (
                    <span className="ml-auto flex flex-none text-(--text-tertiary)">
                      <Check width={14} height={14} />
                    </span>
                  )}
                </Button>
              ))
            )}
          </div>
        </div>
      )}
    </DialogShell>
  );
}
