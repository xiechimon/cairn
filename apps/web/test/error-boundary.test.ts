import { createElement as h, type ReactNode, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { conversationBoundaryKey } from '../src/board/home-c.js';
import { SubtreeErrorBoundary } from '../src/components/subtree-error-boundary.js';
import { I18nProvider } from '../src/i18n/provider.js';

class El {
  nodeType = 1;
  childNodes: Array<El | TextNode> = [];
  attributes = new Map<string, string>();
  listeners = new Map<string, Array<(event: EventLike) => void>>();
  parentNode: El | null = null;
  ownerDocument: Doc | null = null;
  namespaceURI = 'http://www.w3.org/1999/xhtml';
  constructor(readonly tagName: string) {}
  get nodeName() { return this.tagName; }
  setAttribute(key: string, value: string) { this.attributes.set(key, String(value)); }
  getAttribute(key: string) { return this.attributes.get(key) ?? null; }
  removeAttribute(key: string) { this.attributes.delete(key); }
  hasAttribute(key: string) { return this.attributes.has(key); }
  get className() { return this.getAttribute('class') ?? ''; }
  set className(value: string) { this.setAttribute('class', value); }
  get textContent(): string {
    return this.childNodes.map((child) => child.textContent).join('');
  }
  set textContent(value: string) {
    this.childNodes = [];
    if (value) this.appendChild(this.ownerDocument!.createTextNode(value));
  }
  get firstChild(): El | TextNode | null { return this.childNodes[0] ?? null; }
  get nextSibling(): El | TextNode | null {
    const siblings = this.parentNode?.childNodes;
    if (siblings == null) return null;
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  appendChild<T extends El | TextNode>(node: T): T { return this.insertBefore(node, null); }
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
  addEventListener(type: string, fn: (event: EventLike) => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  removeEventListener(type: string, fn: (event: EventLike) => void) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== fn));
  }
  dispatch(type: string, target: El = this) {
    const event: EventLike = {
      type, target, currentTarget: this, bubbles: true, cancelable: true, button: 0, buttons: 0,
      detail: 1, timeStamp: 0, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() {},
    };
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(event);
  }

}

class TextNode {
  nodeType = 3;
  parentNode: El | null = null;
  ownerDocument: Doc | null = null;
  childNodes: never[] = [];
  constructor(public data: string) {}
  get nodeValue() { return this.data; }
  get textContent() { return this.data; }
  set textContent(value: string) { this.data = value; }
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
  createElementNS(_ns: string, tag: string) { return this.createElement(tag); }
  createTextNode(text: string) {
    const node = new TextNode(text);
    node.ownerDocument = this;
    return node;
  }

}

interface EventLike {
  type: string;
  target: El;
  currentTarget: El;
  bubbles: boolean;
  cancelable: boolean;
  button: number;
  buttons: number;
  detail: number;
  timeStamp: number;
  defaultPrevented: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
}

function installTestDom(): El {
  const document = new Doc();
  const root = document.createElement('div');
  document.body = root;
  document.defaultView = globalThis;
  document.appendChild(root);
  for (const [name, value] of Object.entries({ document, HTMLElement: El,
    Element: El, Node: class Node {}, Text: TextNode,
    HTMLIFrameElement: class HTMLIFrameElement {}, SVGElement: class SVGElement {},
    window: globalThis, event: null })) vi.stubGlobal(name, value);
  return root;
}

function walk(node: El | TextNode, acc: El[] = []): El[] {
  if (node instanceof El) {
    acc.push(node);
    for (const child of node.childNodes) walk(child, acc);
  }
  return acc;
}

function byTestId(root: El, id: string): El | undefined {
  return walk(root).find((node) => node.getAttribute('data-testid') === id);
}

function click(root: El, target: El) {
  const host = walk(root).find((node) => node.listeners.has('click')) ?? root;
  host.dispatch('click', target);
}


const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) flushSync(() => root.unmount());
  await new Promise<void>((resolve) => setImmediate(() => setImmediate(resolve)));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function render(child: ReactNode, locale: 'zh' | 'en' = 'en') {
  const host = installTestDom();
  const root = createRoot(host as unknown as HTMLElement);
  roots.push(root);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  flushSync(() => root.render(h(I18nProvider, { initialLocale: locale, children: child })));
  return {
    text: () => host.textContent,
    retry: () => {
      const fallback = byTestId(host, 'error-boundary');
      const button = fallback && walk(fallback).find((node) => node.tagName === 'BUTTON');
      if (!button) throw new Error('Retry button missing');
      flushSync(() => click(host, button));
    },
  };
}

describe('SubtreeErrorBoundary', () => {
  it.each(['en', 'zh'] as const)('catches a render error and retries with fresh state (%s)', (locale) => {
    let fail = false;
    let mounts = 0;
    function Child() {
      useEffect(() => { mounts += 1; }, []);
      if (fail) throw new Error('private failure');
      return h('span', null, 'ready');
    }
    function Trigger() {
      const [broken, setBroken] = useState(false);
      fail = broken;
      return h('button', { onClick: () => setBroken(true) }, h(Child));
    }
    const host = installTestDom();
    const root = createRoot(host as unknown as HTMLElement);
    roots.push(root);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    flushSync(() => root.render(h(I18nProvider, { initialLocale: locale, children: h(SubtreeErrorBoundary, null, h(Trigger)) })));
    expect(host.textContent).toBe('ready');
    expect(mounts).toBe(1);
    flushSync(() => click(host, walk(host).find((node) => node.tagName === 'BUTTON')!));
    expect(host.textContent).toContain(locale === 'en' ? 'This part failed' : '这一块出错了');
    expect(host.textContent).not.toContain('private failure');
    const button = walk(host).find((node) => node.tagName === 'BUTTON')!;
    flushSync(() => click(host, button));
    expect(host.textContent).toBe('ready');
    expect(mounts).toBe(2);
  });

  it.each([new Error('still broken'), null, undefined])('isolates a persistent thrown value (%s)', (thrown) => {
    let attempts = 0;
    let siblingMounts = 0;
    function Broken(): never { attempts += 1; throw thrown; }
    function Sibling() {
      useEffect(() => { siblingMounts += 1; }, []);
      return h('span', null, 'sibling');
    }
    const view = render(h('div', null,
      h(SubtreeErrorBoundary, null, h(Broken)),
      h(SubtreeErrorBoundary, null, h(Sibling))));
    expect(view.text()).toContain('This part failed');
    expect(view.text()).toContain('sibling');
    const before = attempts;
    view.retry();
    expect(attempts).toBeGreaterThan(before);
    expect(view.text()).toContain('This part failed');
    expect(view.text()).toContain('sibling');
    expect(siblingMounts).toBe(1);
  });

  it('clears a fallback when its context changes and leaves a healthy tree mounted', () => {
    let fail = true;
    let mounts = 0;
    function Child() {
      useEffect(() => {
        mounts += 1;
      }, []);
      if (fail) throw new Error('stale');
      return h('span', null, 'ready');
    }
    const host = installTestDom();
    const root = createRoot(host as unknown as HTMLElement);
    roots.push(root);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const view = (resetKey: string) =>
      h(I18nProvider, {
        initialLocale: 'en',
        children: h(SubtreeErrorBoundary, { resetKey, children: h(Child) }),
      });
    flushSync(() => root.render(view('project-a')));
    expect(host.textContent).toContain('This part failed');
    flushSync(() => root.render(view('project-a')));
    expect(host.textContent).toContain('This part failed');
    fail = false;
    flushSync(() => root.render(view('coordinator')));
    expect(host.textContent).toBe('ready');
    const after = mounts;
    flushSync(() => root.render(view('project-b')));
    expect(mounts).toBe(after);
  });

  it('changes the conversation key when a Coordinator deep link switches threads', () => {
    const stuck = conversationBoundaryKey({
      projectId: null,
      chat: null,
      threadId: null,
      chiefThreadId: 'old-thread',
    });
    const next = conversationBoundaryKey({
      projectId: null,
      chat: null,
      threadId: null,
      chiefThreadId: 'linked-thread',
    });
    expect(stuck).toBe('coordinator:::old-thread');
    expect(next).not.toBe(stuck);
  });
});
