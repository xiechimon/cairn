export class SessionNotResumableError extends Error {
  constructor(sessionId: string, detail?: string) {
    super(
      `session ${sessionId} not found on this machine (continue session impossible)` +
        (detail !== undefined ? `: ${detail}` : ''),
    );
    this.name = 'SessionNotResumableError';
  }
}
