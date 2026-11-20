import { buildCommentBridgeScript } from '../../vendor-open-design/comment-bridge.js';
import { buildPreviewSandboxShim } from '../../vendor-open-design/preview-guards.js';

const BODY_CLOSE = /<\/body\s*>/gi;

export function injectBeforeBodyEnd(html: string, payload: string): string {
  let at = -1;
  for (const match of html.matchAll(BODY_CLOSE)) at = match.index;
  return at < 0 ? html + payload : html.slice(0, at) + payload + html.slice(at);
}

export function designSrcdoc(html: string): string {
  return injectBeforeBodyEnd(html, buildPreviewSandboxShim() + buildCommentBridgeScript());
}
