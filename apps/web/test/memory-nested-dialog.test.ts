import { createElement as h, type ReactNode, useLayoutEffect } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import { MemoryPanel } from '../src/chief/memory-panel.js';
import { I18nProvider } from '../src/i18n/provider.js';

const parent = vi.hoisted(() => ({
  nestedDialogs: 0,
  buttons: new Map<string, () => void>(),
}));

function useBaseUiNestedReport(open: boolean) {
  useLayoutEffect(() => {
    parent.nestedDialogs = open ? 1 : 0;
    return () => {
      if (open) parent.nestedDialogs = 0;
    };
  }, [open]);
}

vi.mock('../src/components/ui/dialog-shell.js', () => ({
  DialogShell: ({ open, headerAction }: { open: boolean; headerAction?: ReactNode }) => {
    useBaseUiNestedReport(open);
    return open ? headerAction : null;
  },
}));
vi.mock('../src/components/ui/alert-dialog-shell.js', () => ({
  AlertDialogShell: ({ open, footer }: { open: boolean; footer: ReactNode }) => {
    useBaseUiNestedReport(open);
    return open ? footer : null;
  },
  AlertDialogActions: ({ cancelLabel, onCancel }: { cancelLabel: string; onCancel: () => void }) => {
    parent.buttons.set(cancelLabel, onCancel);
    return null;
  },
}));
vi.mock('../src/components/ui/button.js', () => ({
  Button: (props: { onClick?: () => void; children?: ReactNode; 'aria-label'?: string }) => {
    const label = props['aria-label'] ?? (typeof props.children === 'string' ? props.children : '');
    if (props.onClick !== undefined) parent.buttons.set(label, props.onClick);
    return null;
  },
}));
vi.mock('../src/chief/memory-edit-composer.js', () => ({
  MemoryEditComposer: () => null,
  memoryEditTouchedFiles: () => new Set<string>(),
}));
vi.mock('../src/board/project-instructions-field.js', () => ({ ProjectInstructionsField: () => null }));
vi.mock('../src/api/connection-state.js', () => ({ useConnected: () => true }));
vi.mock('../src/api/hooks.js', () => {
  const idle = { reset: () => {}, mutate: () => {}, isPending: false, isError: false };
  const memory = {
    id: 'memory-1',
    projectId: null,
    layer: 'lookup',
    title: 'code-style',
    content: 'Names carry intent.',
    source: null,
    updatedAt: 0,
  };
  const memories = { data: [memory], isError: false, isFetching: false };
  const none = { data: undefined };
  return {
    useApiMutations: () => ({
      deleteMemory: idle,
      updateMemory: idle,
      importMemoryFile: idle,
      undoMemoryConsolidation: idle,
    }),
    useMemories: () => memories,
    useProjects: () => none,
    useChiefMemoryUsage: () => none,
    useCurrentMemoryEdit: () => none,
    useMemoryConsolidations: () => none,
    useMemoryImportCandidates: () => none,
  };
});

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

let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => {
  flushSync(() => root?.unmount());
  root = undefined;
  await new Promise<void>((resolve) => setImmediate(() => setImmediate(resolve)));
  parent.buttons.clear();
  vi.unstubAllGlobals();
});

function renderPanel() {
  const document = new Doc();
  const host = document.createElement('div');
  document.body = host;
  document.defaultView = globalThis;
  document.appendChild(host);
  for (const [name, value] of Object.entries({
    document,
    HTMLElement: El,
    Element: El,
    HTMLIFrameElement: class HTMLIFrameElement {},
    window: globalThis,
  }))
    vi.stubGlobal(name, value);
  const mounted = createRoot(host as unknown as HTMLElement);
  root = mounted;
  flushSync(() =>
    mounted.render(
      h(I18nProvider, {
        initialLocale: 'en',
        children: h(MemoryPanel, { live: true, teamId: 'team', project: null }),
      }),
    ),
  );
}

const press = (label: string) => {
  const handler = parent.buttons.get(label);
  if (handler === undefined) throw new Error(`no button ${label}`);
  parent.buttons.clear();
  flushSync(handler);
};

test('cancelling a memory delete leaves the memory list knowing a dialog is above it', () => {
  renderPanel();
  press('Open memory: code-style');
  expect(parent.nestedDialogs).toBe(1);
  press('Delete…');
  expect(parent.nestedDialogs).toBe(1);
  press('Cancel');
  expect(parent.nestedDialogs).toBe(1);
});
