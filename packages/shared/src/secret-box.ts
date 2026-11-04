export const SECRET_BOX_ENVELOPE_VERSION = 'v1';

export interface SecretBox {
  seal(plaintext: string): string;
  open(envelope: string): string;
}
