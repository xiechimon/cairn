import { DESIGN_ARTIFACT_CSP } from '@cairn/shared';
import { buildCommentBridgeScript } from '../../vendor-open-design/comment-bridge.js';
import { buildPreviewSandboxShim } from '../../vendor-open-design/preview-guards.js';
import { buildSnapshotBridgeScript } from '../../vendor-open-design/snapshot-bridge.js';

const BODY_CLOSE = /<\/body\s*>/gi;
const HTML_SPACE = String.raw`[\t\n\f\r ]`;
const HTML_TRIVIA = `(?:${HTML_SPACE}|<!--(?!>|->)(?:[^-]|-(?!-))*-->)*`;
const HTML_ATTRIBUTES = String.raw`(?:${HTML_SPACE}+[^\s"'<>/=\x00]+(?:${HTML_SPACE}*=${HTML_SPACE}*(?:"[^"]*"|'[^']*'|[^\s"'=<>\x60\x00]+))?)*${HTML_SPACE}*`;
const DOCUMENT_PREAMBLE = new RegExp(
  `^\uFEFF?${HTML_TRIVIA}(?:<!doctype${HTML_SPACE}+html(?:${HTML_SPACE}[^<>]*)?>${HTML_TRIVIA})?`,
  'i',
);
const DOCUMENT_HEAD_OPEN = new RegExp(
  `^(?:<html${HTML_ATTRIBUTES}>${HTML_TRIVIA})?<head${HTML_ATTRIBUTES}>`,
  'i',
);
const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${DESIGN_ARTIFACT_CSP}">`;

export function injectBeforeBodyEnd(html: string, payload: string): string {
  let at = -1;
  for (const match of html.matchAll(BODY_CLOSE)) at = match.index;
  return at < 0 ? html + payload : html.slice(0, at) + payload + html.slice(at);
}

export function designSrcdoc(html: string): string {
  const preambleEnd = DOCUMENT_PREAMBLE.exec(html)?.[0].length ?? 0;
  const headEnd = DOCUMENT_HEAD_OPEN.exec(html.slice(preambleEnd))?.[0].length ?? 0;
  const at = preambleEnd + headEnd;
  return injectBeforeBodyEnd(
    html.slice(0, at) + CSP_META + html.slice(at),
    buildPreviewSandboxShim() + buildCommentBridgeScript() + buildSnapshotBridgeScript(),
  );
}
