export class SessionNotResumableError extends Error {
  constructor(sessionId: string) {
    super(`session ${sessionId} not found on this machine (continue session impossible)`);
    this.name = 'SessionNotResumableError';
  }
}
