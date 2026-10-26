import type { Dispatch, SetStateAction } from 'react';
import type { useApiMutations } from '../api/hooks.js';
import { blockDemoWrite, DEMO_MODE } from '../demo/demo-gate.js';
import type { Phase } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { uploadMessageAttachments } from '../overlay/attachment-paste.js';

export type ChainState = 'idle' | 'streaming' | 'landed' | 'building';

type Mutations = ReturnType<typeof useApiMutations>;

export interface DetailComposerInput {
  live: boolean;
  phase: Phase;
  buildId: string | null;
  running: boolean;
  mutations: Mutations;
  scrollToEnd: () => void;
  clearDraft: () => void;
  chain: ChainState;
  setChain: Dispatch<SetStateAction<ChainState>>;
  revisionAvailable: boolean;
}

export function useDetailComposer(input: DetailComposerInput) {
  const { live, phase, buildId, running, mutations, chain, setChain, revisionAvailable } = input;
  const { t } = useI18n();

  const onAttachment = live ? (files: File[]) => uploadMessageAttachments(files, t) : undefined;

  const onSend = live
    ? (text: string) => {
        if (text !== '') input.scrollToEnd();
        if (phase === 'confirm' && buildId && text !== '') {
          mutations.stepAction.mutate({
            buildId,
            body: {
              action: 'revision',
              side: 'plan',
              feedback: text,
              clientMessageId: crypto.randomUUID(),
            },
          });
          return;
        }
        if ((phase === 'building' || (phase === 'review' && running)) && buildId && text !== '') {
          return mutations.sendSteer
            .mutateAsync({ conversationId: buildId, content: text })
            .then(() => {
              input.clearDraft();
              return undefined;
            });
        }
        if (phase === 'review' && !running && buildId && text !== '') {
          return mutations.stepAction
            .mutateAsync({
              buildId,
              body: {
                action: 'revision',
                side: 'plan',
                feedback: text,
                clientMessageId: crypto.randomUUID(),
              },
            })
            .then(() => undefined);
        }
        if (phase === 'failed' && buildId && text !== '') {
          return mutations.stepAction
            .mutateAsync({
              buildId,
              body: {
                action: 'restart',
                feedback: text,
                clientMessageId: crypto.randomUUID(),
              },
            })
            .then(() => undefined);
        }
      }
    : DEMO_MODE
      ? () => {
          blockDemoWrite();
        }
      : revisionAvailable && chain === 'idle'
        ? () => {
            setChain('streaming');
            window.setTimeout(() => setChain('landed'), 900);
          }
        : undefined;

  return { onSend, onAttachment };
}
