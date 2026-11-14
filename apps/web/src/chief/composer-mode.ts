export type ComposerMode = 'answer' | 'thread';

export function composerMode(state: {
  questionPending: boolean;
  threadClaimed: boolean;
  quoteStaged: boolean;
}): ComposerMode {
  if (!state.questionPending) return 'thread';
  return state.threadClaimed || state.quoteStaged ? 'thread' : 'answer';
}
