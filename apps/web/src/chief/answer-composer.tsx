import { type ReactNode, type Ref, useEffect, useRef, useSyncExternalStore } from 'react';
import { ShortcutHint } from '../components/shortcut-hint.js';
import { Button } from '../components/ui/button.js';
import { DIALOG_PRIMARY_BUTTON } from '../components/ui/dialog-shell.js';
import { useI18n } from '../i18n/provider.js';
import { joinDraft, splitDraft } from '../overlay/attachment-paste.js';
import { keyedBinding } from './composer-binding.js';
import { ComposerSurface, type ComposerSurfaceHandle } from './composer-surface.js';
import { draftKeyOfAnswer, questionDockState } from './question-dock-state.js';

const answerStore = {
  get: (key: string) => questionDockState.answerText(key),
  set: (key: string, value: string) => questionDockState.setAnswerText(key, value),
};

const NO_MENTIONS = { todo: [], agent: [], project: [], skill: [], machine: [] };

export interface AnswerComposerProps {
  answerKey: string;
  active: boolean;
  attached: boolean;
  home: boolean;
  open: boolean;
  invalid: boolean;
  onAttachment?: ((files: File[]) => string[] | Promise<string[]>) | undefined;
  composerRef?: ((node: HTMLTextAreaElement | null) => void) | undefined;
  handleRef?: Ref<ComposerSurfaceHandle>;
  above: ReactNode;
  tools: ReactNode;
  running: boolean;
  turnElapsed: number | null;
  onFocusEnter: () => void;
  onFocusLeave: () => void;
}

export function AnswerComposer({
  answerKey,
  active,
  attached,
  home,
  open,
  invalid,
  onAttachment,
  composerRef,
  handleRef,
  above,
  tools,
  running,
  turnElapsed,
  onFocusEnter,
  onFocusLeave,
}: AnswerComposerProps) {
  const { t } = useI18n();
  useSyncExternalStore(questionDockState.subscribe, questionDockState.snapshot, () => 0);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);
  const attach =
    onAttachment === undefined
      ? undefined
      : async (files: File[]) => {
          questionDockState.beginUpload();
          try {
            const tokens = await onAttachment(files);
            if (aliveRef.current) return tokens;
            if (tokens.length > 0 && !questionDockState.isClosed(draftKeyOfAnswer(answerKey))) {
              const current = splitDraft(answerStore.get(answerKey));
              answerStore.set(answerKey, joinDraft([...current.tokens, ...tokens], current.text));
            }
            return [];
          } finally {
            questionDockState.endUpload();
          }
        };
  const primary = active ? questionDockState.primary() : null;
  const advance = () => questionDockState.primary()?.advance();
  return (
    <ComposerSurface
      handleRef={handleRef}
      binding={keyedBinding(answerStore, answerKey)}
      editable
      onAttachment={attach}
      mentionGroups={NO_MENTIONS}
      onAdvance={advance}
      primary={
        <Button
          data-testid={active ? 'chief-question-primary' : undefined}
          className={`${DIALOG_PRIMARY_BUTTON} ml-auto`}
          disabled={primary?.enabled !== true}
          onClick={advance}
        >
          {primary?.last === true ? t('提交回答') : t('下一步')}
          <ShortcutHint keys={['mod', 'enter']} className="pointer-coarse:hidden ml-1" />
        </Button>
      }
      active={active}
      attached={attached}
      onFocusEnter={onFocusEnter}
      onFocusLeave={onFocusLeave}
      placeholder={t('输入你自己的回答，或留空使用选中的选项')}
      invalid={invalid}
      home={home}
      open={open}
      composerRef={composerRef}
      above={above}
      tools={tools}
      canStop={false}
      running={running}
      turnElapsed={turnElapsed}
    />
  );
}
