import { TextSelect, Undo } from 'lucide-react';
import { type ReactElement, useEffect, useRef, useState } from 'react';
import { useMediaQuery } from '../../board/use-narrow.js';
import { useI18n } from '../../i18n/provider.js';
import { Copy } from '../../icons/index.js';
import { useCopyWithToast } from '../copy-icon-button.js';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuTrigger,
} from '../ui/context-menu.js';
import { MessageTime } from './message-time.js';

const PRESS_MENU_QUERY = '(max-width: 640px), (pointer: coarse)';

export function useMessagePressMenu(): boolean {
  return useMediaQuery(PRESS_MENU_QUERY);
}

export interface MessageActions {
  at?: number | null | undefined;
  fallbackAt?: string | null | undefined;
  text: string;
  onWithdraw?: (() => void) | undefined;
}

export function MessagePressMenu({
  actions,
  disabled = false,
  children,
}: {
  actions: MessageActions;
  disabled?: boolean;
  children: ReactElement;
}) {
  const { t } = useI18n();
  const copy = useCopyWithToast();
  const body = useRef<HTMLDivElement | null>(null);
  const [selecting, setSelecting] = useState(false);
  const selectAfterClose = useRef(false);
  const picked = useRef('');
  useEffect(() => {
    if (!selecting) return;
    const node = body.current;
    const selection = window.getSelection();
    if (node === null || selection === null) return;
    selection.selectAllChildren(node);
    const release = () => {
      const current = window.getSelection();
      if (current === null || current.isCollapsed || !node.contains(current.anchorNode))
        setSelecting(false);
    };
    document.addEventListener('selectionchange', release);
    return () => document.removeEventListener('selectionchange', release);
  }, [selecting]);
  return (
    <ContextMenu
      disabled={disabled}
      onOpenChangeComplete={(open) => {
        if (open || !selectAfterClose.current) return;
        selectAfterClose.current = false;
        setSelecting(true);
      }}
    >
      <ContextMenuTrigger
        ref={body}
        render={children}
        className={selecting ? 'select-text' : 'pointer-coarse:select-none'}
        data-selecting={selecting ? '' : undefined}
        data-press-menu=""
        onPointerDown={() => {
          const selection = window.getSelection();
          const node = body.current;
          picked.current =
            selection !== null &&
            node !== null &&
            !selection.isCollapsed &&
            node.contains(selection.anchorNode) &&
            node.contains(selection.focusNode)
              ? selection.toString()
              : '';
        }}
      />
      <ContextMenuContent aria-label={t('消息操作')} data-testid="message-press-menu">
        <ContextMenuGroup>
          <ContextMenuLabel>
            <MessageTime at={actions.at} fallback={actions.fallbackAt} />
          </ContextMenuLabel>
          <ContextMenuItem onClick={() => copy(picked.current || actions.text)}>
            <Copy />
            {t('复制')}
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => {
              selectAfterClose.current = true;
            }}
          >
            <TextSelect />
            {t('选择文字')}
          </ContextMenuItem>
          {actions.onWithdraw !== undefined && (
            <ContextMenuItem data-testid="chief-steer-withdraw" onClick={actions.onWithdraw}>
              <Undo />
              {t('撤回')}
            </ContextMenuItem>
          )}
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  );
}
