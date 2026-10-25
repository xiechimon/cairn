import { describe, expect, it } from 'vitest';
import { isValidFileName } from '../src/api/attachments.js';
import { parseChatMarkdown } from '../src/detail/chat-markdown.js';
import {
  createPastedNameCounter,
  filesFromClipboardData,
  insertAttachmentTokens,
  isGenericClipboardName,
  parseAttachmentTokens,
  pastedImageExt,
  preparePastedFiles,
} from '../src/overlay/attachment-paste.js';

const TOKEN = '![pasted-image-1.png](attachment:team-1/att-1.png)';
const TOKEN2 = '![pasted-image-2.png](attachment:team-1/att-2.png)';

function tokenLines(value: string): string[] {
  return value.split('\n').filter((line) => line.includes('attachment:'));
}

describe('insertAttachmentTokens — row-atomic caret insertion (FM1)', () => {
  it('empty draft: token owns the first row, caret lands at the next row head after the block', () => {
    const r = insertAttachmentTokens('', [TOKEN], 0);
    expect(r.value).toBe(`${TOKEN}\n`);
    expect(r.caret).toBe(TOKEN.length + 1);
  });

  it('caret at row start (offset 0): token row inserted before the original text, original not broken', () => {
    const r = insertAttachmentTokens('abc', [TOKEN], 0);
    expect(r.value).toBe(`${TOKEN}\nabc`);
    expect(r.caret).toBe(TOKEN.length + 1);
  });

  it('caret mid-row: both sides break into rows, token owns its own row', () => {
    const r = insertAttachmentTokens('hello world', [TOKEN], 5);
    expect(r.value).toBe(`hello\n${TOKEN}\n world`);
    expect(r.caret).toBe('hello\n'.length + TOKEN.length + '\n'.length);
    for (const line of tokenLines(r.value)) {
      expect(line.trim()).toBe(TOKEN);
    }
  });

  it('caret at end of text (no trailing newline): leading break added + trailing newline appended', () => {
    const r = insertAttachmentTokens('abc', [TOKEN], 3);
    expect(r.value).toBe(`abc\n${TOKEN}\n`);
    expect(r.caret).toBe(r.value.length);
  });

  it('caret immediately before a newline: no stacked double blank line, caret skips the existing newline to the next row head', () => {
    const r = insertAttachmentTokens('abc\ndef', [TOKEN], 3);
    expect(r.value).toBe(`abc\n${TOKEN}\ndef`);
    expect(r.caret).toBe('abc\n'.length + TOKEN.length + '\n'.length);
  });

  it('caret = null (clip tail-chase path) is byte-for-byte equivalent to the old appendAttachmentTokens', () => {

    const legacyAppend = (draft: string, tokens: string[]) => {
      const joiner = draft === '' || draft.endsWith('\n') ? '' : '\n';
      return `${draft}${joiner}${tokens.join('\n')}\n`;
    };
    for (const draft of ['', 'abc', 'abc\n', 'abc\ndef']) {
      expect(insertAttachmentTokens(draft, [TOKEN], null).value).toBe(legacyAppend(draft, [TOKEN]));
    }
  });

  it('multiple images pasted at once: each token on its own row', () => {
    const r = insertAttachmentTokens('x', [TOKEN, TOKEN2], 1);
    expect(r.value).toBe(`x\n${TOKEN}\n${TOKEN2}\n`);
    expect(tokenLines(r.value)).toHaveLength(2);
    for (const line of tokenLines(r.value)) {
      expect(line.trim() === TOKEN || line.trim() === TOKEN2).toBe(true);
    }
  });

  it('empty token set: original value and caret unchanged, draft untouched', () => {
    const r = insertAttachmentTokens('abc', [], 1);
    expect(r.value).toBe('abc');
    expect(r.caret).toBe(1);
  });

  it('caret out of range (stale offset) treated as end of text, still row-atomic', () => {
    const r = insertAttachmentTokens('abc', [TOKEN], 99);
    expect(r.value).toBe(`abc\n${TOKEN}\n`);
  });

  it('user keeps typing during upload: stale-offset insertion still keeps the token on its own row', () => {

    const r = insertAttachmentTokens('abcXYdef', [TOKEN], 3);
    expect(r.value).toBe(`abc\n${TOKEN}\nXYdef`);
    for (const line of tokenLines(r.value)) {
      expect(line.trim()).toBe(TOKEN);
    }
  });

  it('the insertion result parses into an attachment block through the real renderer (chip does not degrade)', () => {
    const r = insertAttachmentTokens('hello world', [TOKEN], 5);
    const blocks = parseChatMarkdown(r.value);
    const attachment = blocks.find((b) => b.kind === 'attachment');
    expect(attachment).toBeDefined();
    expect(attachment?.kind === 'attachment' && attachment.name).toBe('pasted-image-1.png');
    expect(attachment?.kind === 'attachment' && attachment.key).toBe('team-1/att-1.png');
  });

  it('negative pin: a token squeezed mid-row parses to no attachment block (degrades to literal text)', () => {
    const blocks = parseChatMarkdown(`hello ${TOKEN} world`);
    expect(blocks.some((b) => b.kind === 'attachment')).toBe(false);
  });
});

describe('filesFromClipboardData — single-source extraction (FM2 / FM7)', () => {
  const file = new File([new Uint8Array([1, 2, 3])], 'image.png', { type: 'image/png' });

  it('null / undefined → empty set', () => {
    expect(filesFromClipboardData(null)).toEqual([]);
    expect(filesFromClipboardData(undefined)).toEqual([]);
  });

  it('files present → reads files only, same-source copies in items no longer counted (double-trigger defense)', () => {
    const out = filesFromClipboardData({
      files: [file],
      items: [{ kind: 'file', getAsFile: () => file }],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(file);
  });

  it('files empty, items hold file entries → fallback reads items (Firefox/Safari shape difference)', () => {
    const out = filesFromClipboardData({
      files: [],
      items: [
        { kind: 'file', getAsFile: () => file },
        { kind: 'string', getAsFile: () => null },
      ],
    });
    expect(out).toEqual([file]);
  });

  it('plain-text clipboard → empty set (the handler leaves the event alone, text paste unchanged)', () => {
    expect(filesFromClipboardData({ files: [], items: [{ kind: 'string', getAsFile: () => null }] })).toEqual([]);
  });
});

describe('isGenericClipboardName — generic-name judgment (FM6)', () => {
  it('no name / image.<ext> / blob = generic name', () => {
    expect(isGenericClipboardName('')).toBe(true);
    expect(isGenericClipboardName('image.png')).toBe(true);
    expect(isGenericClipboardName('Image.PNG')).toBe(true);
    expect(isGenericClipboardName('blob')).toBe(true);
    expect(isGenericClipboardName('BLOB')).toBe(true);
  });

  it('real file names are not judged generic (including OS screenshot names / multi-segment extensions)', () => {
    expect(isGenericClipboardName('photo.png')).toBe(false);
    expect(isGenericClipboardName('report.pdf')).toBe(false);
    expect(isGenericClipboardName('my-image.png')).toBe(false);
    expect(isGenericClipboardName('image.tar.gz')).toBe(false);
    expect(isGenericClipboardName('截屏2026-10-03 14.25.30.png')).toBe(false);
  });
});

describe('pastedImageExt — mime → extension (FM6, must pass the server ALLOWED_EXTS)', () => {
  it('common image mimes map to whitelisted extensions', () => {
    expect(pastedImageExt('image/png')).toBe('png');
    expect(pastedImageExt('image/jpeg')).toBe('jpg');
    expect(pastedImageExt('image/gif')).toBe('gif');
    expect(pastedImageExt('image/webp')).toBe('webp');
    expect(pastedImageExt('image/svg+xml')).toBe('svg');
    expect(pastedImageExt('image/bmp')).toBe('bmp');
    expect(pastedImageExt('image/x-icon')).toBe('ico');
    expect(pastedImageExt('image/avif')).toBe('avif');
  });

  it('non-image mime / empty mime / odd subtype → null (no extension invented)', () => {
    expect(pastedImageExt('application/pdf')).toBeNull();
    expect(pastedImageExt('')).toBeNull();
    expect(pastedImageExt('image/x-foo-bar')).toBeNull();
  });
});

describe('createPastedNameCounter — per-draft incrementing counter (FM6 / FM2)', () => {
  it('multiple images in one draft increment without name collisions', () => {
    const c = createPastedNameCounter();
    c.begin(false);
    expect(c.next('png')).toBe('pasted-image-1.png');
    expect(c.next('png')).toBe('pasted-image-2.png');
    c.end();
  });

  it('draft cleared and no in-flight upload → restarts from 1 (the CC per-draft numbering spirit)', () => {
    const c = createPastedNameCounter();
    c.begin(true);
    c.next('png');
    c.next('png');
    c.end();
    c.begin(true);
    expect(c.next('png')).toBe('pasted-image-1.png');
    c.end();
  });

  it('rapid consecutive pastes: while the previous batch is in flight and the draft still empty, no reset (no name collision within one draft)', () => {
    const c = createPastedNameCounter();
    c.begin(true);
    expect(c.next('png')).toBe('pasted-image-1.png');

    c.begin(true);
    expect(c.next('png')).toBe('pasted-image-2.png');
    c.end();
    c.end();
  });

  it('non-empty draft → keeps incrementing', () => {
    const c = createPastedNameCounter();
    c.begin(false);
    expect(c.next('jpg')).toBe('pasted-image-1.jpg');
    c.end();
    c.begin(false);
    expect(c.next('jpg')).toBe('pasted-image-2.jpg');
    c.end();
  });

  it('end called multiple times does not underflow negative (the finally double-guard does not blow up the later reset judgment)', () => {
    const c = createPastedNameCounter();
    c.begin(true);
    c.end();
    c.end();
    c.begin(true);
    expect(c.next('png')).toBe('pasted-image-1.png');
    c.end();
  });
});

describe('preparePastedFiles — generic-name blob renaming (FM6)', () => {
  const counter = () => {
    const c = createPastedNameCounter();
    c.begin(true);
    return c;
  };

  it('generic-name screenshot blob → pasted-image-<n>.<ext>, type and bytes preserved', () => {
    const blob = new File([new Uint8Array([9, 8, 7])], 'image.png', { type: 'image/png' });
    const [out] = preparePastedFiles([blob], counter());
    expect(out?.name).toBe('pasted-image-1.png');
    expect(out?.type).toBe('image/png');
    expect(out?.size).toBe(3);
  });

  it('nameless blobs get an extension from the mime', () => {
    const blob = new File([new Uint8Array([1])], '', { type: 'image/jpeg' });
    const [out] = preparePastedFiles([blob], counter());
    expect(out?.name).toBe('pasted-image-1.jpg');
  });

  it('when the mime yields no extension, falls back to the original filename last-segment extension', () => {
    const blob = new File([new Uint8Array([1])], 'image.png', { type: '' });
    const [out] = preparePastedFiles([blob], counter());
    expect(out?.name).toBe('pasted-image-1.png');
  });

  it('real file names untouched (same object passed through, no byte copied)', () => {
    const named = new File([new Uint8Array([1])], 'report.pdf', { type: 'application/pdf' });
    const [out] = preparePastedFiles([named], counter());
    expect(out).toBe(named);
  });

  it('multiple images pasted at once: synthesized names do not collide and all pass isValidFileName', () => {
    const mk = () => new File([new Uint8Array([1])], 'image.png', { type: 'image/png' });
    const out = preparePastedFiles([mk(), mk(), mk()], counter());
    const names = out.map((f) => f.name);
    expect(new Set(names).size).toBe(3);
    for (const name of names) {
      expect(isValidFileName(name)).toBe(true);
    }
  });
});

describe('parseAttachmentTokens — whole-draft row-token parsing (#757 strip data source)', () => {
  it('a token on its own row parses out name + key', () => {
    expect(parseAttachmentTokens(`${TOKEN}\n`)).toEqual([
      { name: 'pasted-image-1.png', key: 'team-1/att-1.png' },
    ]);
  });

  it('multi-token rows return tokens in draft order', () => {
    expect(parseAttachmentTokens(`hello\n${TOKEN}\n${TOKEN2}\n world`)).toEqual([
      { name: 'pasted-image-1.png', key: 'team-1/att-1.png' },
      { name: 'pasted-image-2.png', key: 'team-1/att-2.png' },
    ]);
  });

  it('inline tokens mid-row do not parse (same law as ATTACHMENT_LINE, no chip-ification)', () => {
    expect(parseAttachmentTokens(`look ${TOKEN} here`)).toEqual([]);
  });

  it('empty draft and plain text return the empty set', () => {
    expect(parseAttachmentTokens('')).toEqual([]);
    expect(parseAttachmentTokens('just words\nmore words')).toEqual([]);
  });

  it('parse results share the renderer source: every hit row parses as an attachment block through parseChatMarkdown', () => {
    const draft = `note\n${TOKEN}\n${TOKEN2}\ntail`;
    const parsed = parseAttachmentTokens(draft);
    const blocks = parseChatMarkdown(draft).filter((b) => b.kind === 'attachment');
    expect(parsed.length).toBe(blocks.length);
    expect(parsed.map((p) => p.key)).toEqual(
      blocks.map((b) => (b.kind === 'attachment' ? b.key : '')),
    );
  });
});
