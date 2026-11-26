export class SendTimeoutError extends Error {
  constructor() {
    super('The server did not answer in time');
    this.name = 'SendTimeoutError';
  }
}

export class SendStaleError extends Error {
  constructor() {
    super('The send is too old to repeat on its own');
    this.name = 'SendStaleError';
  }
}
