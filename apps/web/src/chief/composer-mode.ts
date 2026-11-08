export type ComposerMode = 'answer' | 'thread';

export function composerMode(state: {
  answerHere: boolean;
  questionPending: boolean;
  threadClaimed: boolean;
  quoteStaged: boolean;
}): ComposerMode {
  if (!state.answerHere || !state.questionPending) return 'thread';
  return state.threadClaimed || state.quoteStaged ? 'thread' : 'answer';
}
