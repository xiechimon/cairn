const CONTROL_CHARACTERS = /\p{Cc}/gu;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const WELL_FORMED_REPLACEMENT = '\uFFFD';
const NOT_QUOTED_STRING_SAFE = /["\\]|[^\x20-\x7e]+/g;
const NOT_RFC_5987_ATTRIBUTE_CHARACTER = /['()*]/g;
const FALLBACK_NAME = 'download';

export function attachmentDownloadDisposition(fileName: string): string {
  const name =
    fileName
      .replace(LONE_SURROGATE, WELL_FORMED_REPLACEMENT)
      .replace(CONTROL_CHARACTERS, '')
      .trim() || FALLBACK_NAME;
  const asciiName = name.replace(NOT_QUOTED_STRING_SAFE, '_').trim() || FALLBACK_NAME;
  const encodedName = encodeURIComponent(name).replace(
    NOT_RFC_5987_ATTRIBUTE_CHARACTER,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`;
}
