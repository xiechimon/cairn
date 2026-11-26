import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement as h, type ReactNode, useLayoutEffect } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommentLayerProvider, useCommentLayer, useFileComments } from '../src/board/artifact/file-comments.js';
import { I18nProvider } from '../src/i18n/provider.js';

class El {
  nodeType = 1;
  childNodes: Array<El | TextNode> = [];
  attributes = new Map<string, string>();
  listeners = new Map<string, Array<(event: unknown) => void>>();
  parentNode: El | null = null;
  ownerDocument: Doc | null = null;
  namespaceURI = 'http://www.w3.org/1999/xhtml';
  constructor(readonly tagName: string) {}
  get nodeName() {
    return this.tagName;
  }
  setAttribute(key: string, value: string) {
    this.attributes.set(key, String(value));
  }
  getAttribute(key: string) {
    return this.attributes.get(key) ?? null;
  }
  removeAttribute(key: string) {
    this.attributes.delete(key);
  }
  appendChild<T extends El | TextNode>(node: T): T {
    return this.insertBefore(node, null);
  }
  insertBefore<T extends El | TextNode>(node: T, ref: El | TextNode | null): T {
    node.parentNode?.removeChild(node);
    node.parentNode = this;
    const index = ref == null ? -1 : this.childNodes.indexOf(ref);
    if (index === -1) this.childNodes.push(node);
    else this.childNodes.splice(index, 0, node);
    return node;
  }
  removeChild<T extends El | TextNode>(node: T): T {
    const index = this.childNodes.indexOf(node);
    if (index >= 0) this.childNodes.splice(index, 1);
    node.parentNode = null;
    return node;
  }
  addEventListener(type: string, fn: (event: unknown) => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  removeEventListener(type: string, fn: (event: unknown) => void) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((item) => item !== fn),
    );
  }
}

class TextNode {
  nodeType = 3;
  parentNode: El | null = null;
  ownerDocument: Doc | null = null;
  childNodes: never[] = [];
  constructor(public data: string) {}
}

class Doc extends El {
  documentElement: El;
  body: El | null = null;
  defaultView: typeof globalThis | null = null;
  activeElement: El | null = null;
  constructor() {
    super('#document');
    this.nodeType = 9;
    this.documentElement = this.createElement('html');
  }
  createElement(tag: string) {
    const el = new El(tag.toUpperCase());
    el.ownerDocument = this;
    return el;
  }
  createElementNS(_ns: string, tag: string) {
    return this.createElement(tag);
  }
  createTextNode(text: string) {
    const node = new TextNode(text);
    node.ownerDocument = this;
    return node;
  }
}

function installTestDom(): El {
  const document = new Doc();
  const root = document.createElement('div');
  document.body = root;
  document.defaultView = globalThis;
  document.appendChild(root);
  for (const [name, value] of Object.entries({
    document,
    HTMLElement: El,
    Element: El,
    Node: class Node {},
    Text: TextNode,
    HTMLIFrameElement: class HTMLIFrameElement {},
    SVGElement: class SVGElement {},
    window: globalThis,
    event: null,
  })) {
    vi.stubGlobal(name, value);
  }
  return root;
}

const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) flushSync(() => root.unmount());
  await new Promise<void>((resolve) => setImmediate(() => setImmediate(resolve)));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function withProviders(qc: QueryClient, child: ReactNode): ReactNode {
  return h(
    QueryClientProvider,
    { client: qc },
    h(I18nProvider, { initialLocale: 'en', children: child }),
  );
}

describe('useFileComments render stability', () => {
  it('does not loop when a viewer reports identical lostElements on layout', () => {
    const host = installTestDom();
    const root = createRoot(host as unknown as HTMLElement);
    roots.push(root);
    vi.stubGlobal('fetch', async () => Response.json([]));
    const qc = new QueryClient({
      defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } },
    });
    qc.setQueryData(['design', 'todo-1', 'comments', 'report.md'], []);

    let renders = 0;
    const seenComments: Array<readonly unknown[]> = [];
    let latestReport: ((extent: { lostElements?: ReadonlySet<string>; lines?: number }) => void) | undefined;

    function ViewerStub() {
      const layer = useCommentLayer();
      const comments = layer?.comments;
      const report = layer?.report;
      latestReport = report;
      if (comments !== undefined) seenComments.push(comments);
      useLayoutEffect(() => {
        report?.({ lostElements: new Set(['cmt-1']) });
      }, [comments, report]);
      return h('span', null, String(comments?.length ?? 0));
    }

    function Harness() {
      renders += 1;
      const fileComments = useFileComments({
        todoId: 'todo-1',
        fileName: 'report.md',
        versionId: 'ver-1',
        enabled: true,
        readOnly: false,
        sendComments: undefined,
      });
      return h(CommentLayerProvider, {
        layer: fileComments.layer,
        children: h(ViewerStub),
      });
    }

    flushSync(() => {
      root.render(withProviders(qc, h(Harness)));
    });

    expect(renders).toBeLessThanOrEqual(4);
    const initialCommentsRef = seenComments[0];

    flushSync(() => {
      latestReport?.({ lostElements: new Set(['cmt-1']) });
    });
    const steadyRenders = renders;
    flushSync(() => {
      latestReport?.({ lostElements: new Set(['cmt-1']) });
    });
    expect(renders).toBe(steadyRenders);

    flushSync(() => {
      latestReport?.({ lines: 42 });
    });
    expect(seenComments.every((ref) => ref === initialCommentsRef)).toBe(true);
  });
});
