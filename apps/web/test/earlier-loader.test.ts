import { createElement as h } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EarlierLoader } from '../src/components/chat/earlier-loader.js';

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
  get textContent(): string {
    return this.childNodes.map((child) => child.textContent).join('');
  }
  set textContent(value: string) {
    this.childNodes = [];
    if (value) this.appendChild(this.ownerDocument!.createTextNode(value));
  }
  get firstChild(): El | TextNode | null {
    return this.childNodes[0] ?? null;
  }
  get nextSibling(): El | TextNode | null {
    const siblings = this.parentNode?.childNodes;
    if (siblings == null) return null;
    return siblings[siblings.indexOf(this) + 1] ?? null;
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
  get nodeValue() {
    return this.data;
  }
  get textContent() {
    return this.data;
  }
  set textContent(value: string) {
    this.data = value;
  }
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
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
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
  }))
    vi.stubGlobal(name, value);
  return root;
}

class FakeItem {
  isConnected = true;
  rect: { top: number; bottom: number };
  constructor(top: number, bottom: number) {
    this.rect = { top, bottom };
  }
  getBoundingClientRect() {
    return this.rect;
  }
}

class FakeViewport {
  scrollTop = 0;
  scrollHeight = 12_000;
  clientHeight = 800;
  items: FakeItem[];
  private listeners = new Map<string, Array<() => void>>();
  constructor(item: FakeItem) {
    this.items = [item];
  }
  addEventListener(type: string, fn: () => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  removeEventListener(type: string, fn: () => void) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((item) => item !== fn),
    );
  }
  dispatch(type: string) {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn();
  }
  getBoundingClientRect() {
    return { top: 0, bottom: this.clientHeight };
  }
  querySelectorAll() {
    return this.items;
  }
}

const rafQueue: Array<() => void> = [];
const runRaf = () => {
  for (const cb of rafQueue.splice(0)) cb();
};

const roots: Array<ReturnType<typeof createRoot>> = [];
afterEach(async () => {
  for (const root of roots.splice(0)) flushSync(() => root.unmount());
  await new Promise<void>((resolve) => setImmediate(() => setImmediate(resolve)));
  rafQueue.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setup() {
  const host = installTestDom();
  const root = createRoot(host as unknown as HTMLElement);
  roots.push(root);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const loads: number[] = [];
  const item = new FakeItem(0, 200);
  const viewport = new FakeViewport(item);
  const viewportRef = { current: viewport as unknown as HTMLDivElement };
  const render = (props: { loading: boolean; rowCount: number; hasEarlier?: boolean }) =>
    flushSync(() =>
      root.render(
        h(EarlierLoader, {
          earlier: {
            loading: props.loading,
            failed: false,
            onLoad: () => loads.push(1),
          },
          hasEarlier: props.hasEarlier ?? true,
          rowCount: props.rowCount,
          viewportRef,
        }),
      ),
    );
  return { loads, item, viewport, render };
}

describe('EarlierLoader', () => {
  it('blocks a new older-page request until the pending anchor restore ran', () => {
    const { loads, item, viewport, render } = setup();
    render({ loading: false, rowCount: 100 });
    expect(loads).toHaveLength(1);
    render({ loading: true, rowCount: 100 });
    viewport.scrollHeight = 24_000;
    render({ loading: false, rowCount: 200 });
    viewport.dispatch('scroll');
    expect(loads).toHaveLength(1);
    item.rect = { top: 12_000, bottom: 12_200 };
    runRaf();
    expect(viewport.scrollTop).toBe(12_000);
    expect(loads).toHaveLength(1);
    viewport.scrollTop = 0;
    viewport.dispatch('scroll');
    expect(loads).toHaveLength(2);
  });

  it('keeps loading older pages after a restore while the reader stays at the top', () => {
    const { loads, viewport, render } = setup();
    viewport.scrollHeight = 600;
    render({ loading: false, rowCount: 10 });
    expect(loads).toHaveLength(1);
    render({ loading: true, rowCount: 10 });
    viewport.scrollHeight = 900;
    render({ loading: false, rowCount: 20 });
    runRaf();
    expect(loads).toHaveLength(2);
  });
});
