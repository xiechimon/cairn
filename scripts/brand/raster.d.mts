export interface Bitmap {
  width: number;
  height: number;
  pixels: Buffer;
}
export function decodePng(buffer: Buffer): Bitmap;
export function decodeIcns(buffer: Buffer): [type: string, png: Buffer][];
