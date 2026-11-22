import { DESIGN_ARTIFACT_CSP } from '@cairn/shared';
import { buildCommentBridgeScript } from '../../vendor-open-design/comment-bridge.js';
import { buildPreviewSandboxShim } from '../../vendor-open-design/preview-guards.js';
import { buildSnapshotBridgeScript } from '../../vendor-open-design/snapshot-bridge.js';

const PREVIEW_PREFIX =
  `<!doctype html><head><meta http-equiv="Content-Security-Policy" content="${DESIGN_ARTIFACT_CSP}">` +
  buildPreviewSandboxShim() +
  buildCommentBridgeScript() +
  buildSnapshotBridgeScript();

export function designSrcdoc(html: string): string {
  return PREVIEW_PREFIX + (html.startsWith('\uFEFF') ? html.slice(1) : html);
}
