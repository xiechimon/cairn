export class SendTimeoutError extends Error {
  constructor() {
    super('The server did not answer in time');
    this.name = 'SendTimeoutError';
  }
}

export class SendCancelledError extends Error {
  constructor() {
    super('The message was removed from the queue');
    this.name = 'SendCancelledError';
  }
}

export class SendStaleError extends Error {
  constructor() {
    super('The send is too old to repeat on its own');
    this.name = 'SendStaleError';
  }
}

export class ServerUnreachableError extends Error {
  constructor(cause?: unknown) {
    super('The server could not be reached', { cause });
    this.name = 'ServerUnreachableError';
  }
}
