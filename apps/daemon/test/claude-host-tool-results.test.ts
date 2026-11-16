import { describe, expect, test } from 'vitest';
import { hostToolContent } from '../src/backend/host-tool-content.js';

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('rest of a picture'),
]).toString('base64');
const attachment = (mimeType: string, content: string, encoding = 'base64') =>
  JSON.stringify({ mimeType, encoding, content });

describe('hostToolContent', () => {
  test('an image attachment whose bytes match its type becomes an image block', () => {
    expect(hostToolContent('attachment', attachment('image/png', png))).toEqual([
      { type: 'image', data: png, mimeType: 'image/png' },
    ]);
  });

  test('an image the provider would reject is described in text instead of sent', () => {
    const wrongType = hostToolContent('attachment', attachment('image/jpeg', png));
    expect(wrongType).toEqual([{ type: 'text', text: 'This attachment is not a readable image.' }]);
    expect(hostToolContent('attachment', attachment('image/png', ''))[0]).toMatchObject({
      type: 'text',
    });
    expect(
      hostToolContent(
        'attachment',
        attachment('image/png', Buffer.from('plain').toString('base64')),
      ),
    ).toEqual([{ type: 'text', text: 'This attachment is not a readable image.' }]);
    const huge = hostToolContent(
      'attachment',
      attachment('image/png', 'A'.repeat(4 * 1024 * 1024 + 1)),
    );
    expect(huge).toHaveLength(1);
    expect((huge[0] as { text: string }).text.length).toBeLessThan(200);
  });

  test('text attachments, other tools and non-JSON results stay text', () => {
    const textFile = attachment('text/plain', 'hi', 'utf8');
    expect(hostToolContent('attachment', textFile)).toEqual([{ type: 'text', text: textFile }]);
    const image = attachment('image/png', png);
    expect(hostToolContent('todos', image)).toEqual([{ type: 'text', text: image }]);
    expect(hostToolContent('attachment', 'not json')).toEqual([{ type: 'text', text: 'not json' }]);
  });
});
