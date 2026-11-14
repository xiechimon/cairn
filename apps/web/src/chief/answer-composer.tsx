import { type ReactNode, type Ref, useEffect, useRef, useSyncExternalStore } from 'react';
import type { ChiefContextUsage } from '../fixtures/records.js';
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
  onAttachment?: ((files: File[]) => string[] | Promise<string[]>) | undefined;
  composerRef?: ((node: HTMLTextAreaElement | null) => void) | undefined;
  handleRef?: Ref<ComposerSurfaceHandle>;
  above: ReactNode;
  tools: ReactNode;
  context?: ChiefContextUsage | undefined;
  threadId?: string | null;
  onFocusEnter: () => void;
  onFocusLeave: () => void;
  dropActive?: boolean;
}

export function AnswerComposer({
  answerKey,
  active,
  onAttachment,
  composerRef,
  handleRef,
  above,
  tools,
  context,
  threadId = null,
  onFocusEnter,
  onFocusLeave,
  dropActive = false,
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
      send={{
        label: primary?.last === false ? t('下一步') : t('提交回答'),
        testId: active ? 'chief-question-primary' : '',
        enabled: primary?.enabled === true,
        onClick: advance,
      }}
      active={active}
      onFocusEnter={onFocusEnter}
      onFocusLeave={onFocusLeave}
      placeholder={t('输入你自己的回答…')}
      composerRef={composerRef}
      above={above}
      tools={tools}
      context={context}
      threadId={threadId}
      dropActive={dropActive}
    />
  );
}
