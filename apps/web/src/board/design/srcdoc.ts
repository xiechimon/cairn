import { DESIGN_ARTIFACT_CSP } from '@cairn/shared';
import { buildCommentBridgeScript } from '../../vendor-open-design/comment-bridge.js';
import { buildPreviewSandboxShim } from '../../vendor-open-design/preview-guards.js';
import { buildSnapshotBridgeScript } from '../../vendor-open-design/snapshot-bridge.js';

function keepRoundTrippablePreamble(
  boundaries: readonly Node[],
  template: HTMLTemplateElement,
  serializer: XMLSerializer,
): void {
  for (const boundary of boundaries) {
    for (let node = boundary.previousSibling; node !== null; ) {
      const previous = node.previousSibling;
      if (node instanceof Comment) {
        template.innerHTML = serializer.serializeToString(node);
        const first = template.content.firstChild;
        if (!(first instanceof Comment) || first.nextSibling !== null || first.data !== node.data) {
          node.remove();
        }
      }
      node = previous;
    }
  }
}

export function designSrcdoc(html: string): string {
  const bom = html.startsWith('\uFEFF') ? '\uFEFF' : '';
  const doc = new DOMParser().parseFromString(html.slice(bom.length), 'text/html');
  const template = doc.createElement('template');
  const serializer = new XMLSerializer();
  keepRoundTrippablePreamble([doc.documentElement, doc.head], template, serializer);

  const policy = doc.createElement('meta');
  policy.httpEquiv = 'Content-Security-Policy';
  policy.content = DESIGN_ARTIFACT_CSP;
  template.innerHTML =
    buildPreviewSandboxShim() + buildCommentBridgeScript() + buildSnapshotBridgeScript();
  for (const script of template.content.querySelectorAll('script')) {
    script.textContent = `document.addEventListener('DOMContentLoaded', () => {\n${script.textContent}\n}, { once: true });`;
  }
  doc.head.prepend(policy, template.content);

  return (
    bom +
    Array.from(doc.childNodes, (node) =>
      node instanceof Element ? node.outerHTML : serializer.serializeToString(node),
    ).join('')
  );
}
