import {
  antigravitySubscriptionModelSchema,
  claudeSubscriptionModelSchema,
  devinSubscriptionModelSchema,
  type ProviderRecord,
} from '@cairn/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement as h, type ComponentProps, type MouseEvent, type ReactNode, useLayoutEffect } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../src/i18n/provider.js';
import { TeamProviderEditor } from '../src/resources/provider-editors.js';
import { ProvidersSection } from '../src/resources/providers-page.js';
import { groupAntigravityUpstream, groupDevinUpstream } from '../src/resources/upstream-model-groups.js';
import { deriveModelSource, UpstreamModelPicker } from '../src/resources/upstream-model-picker.js';

const dialogFocus = vi.hoisted(() => ({
  initialFocus: undefined as ComponentProps<typeof import('../src/components/ui/dialog-shell.js').DialogShell>['initialFocus'],
}));

vi.mock('../src/components/ui/dialog.js', () => ({
  Dialog: ({ children }: { children: ReactNode }) => children,
  DialogClose: () => null,
  DialogContent: ({ children, className, initialFocus, finalFocus }: ComponentProps<
    typeof import('../src/components/ui/dialog.js').DialogContent
  >) => {
    dialogFocus.initialFocus = initialFocus;
    useLayoutEffect(() => () => {
      queueMicrotask(() => {
        if (typeof finalFocus !== 'function') return;
        const target = finalFocus('keyboard');
        if (target instanceof HTMLElement) target.focus({ preventScroll: true });
      });
    }, [finalFocus]);
    return h('div', { role: 'dialog', className }, children);
  },
  DialogDescription: ({ children }: { children: ReactNode }) => h('p', null, children),
  DialogTitle: ({ children }: { children: ReactNode }) => h('h2', null, children),
}));

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock('../src/api/client.js', () => ({ api, ApiError: class ApiError extends Error {} }));
vi.mock('../src/api/provider.js', () => ({ useLiveData: () => ({ live: true, teamId: 'test-team' }) }));
vi.mock('../src/resources/add-provider-flow.js', () => ({ AddProviderFlow: () => null }));
vi.mock('../src/components/icon-tooltip.js', () => ({
  IconTooltip: ({ trigger }: { trigger: ReactNode }) => trigger,
}));
vi.mock('../src/components/ui/alert-dialog-shell.js', () => ({
  AlertDialogActions: () => null,
  AlertDialogShell: () => null,
}));
vi.mock('../src/components/providers/provider-panel.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/components/providers/provider-panel.js')>()),
  ProviderPanel: ({ children, items, onSelect }: ComponentProps<
    typeof import('../src/components/providers/provider-panel.js').ProviderPanel
  >) => [
    ...items.map(({ id, name }) => h('button', { key: id, onClick: () => onSelect(id) }, name)),
    children,
  ],
}));
vi.mock('../src/resources/subscription-detail.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/resources/subscription-detail.js')>()),
  SubscriptionDetail: ({ actions }: ComponentProps<
    typeof import('../src/resources/subscription-detail.js').SubscriptionDetail
  >) => h('button', { onClick: (event: MouseEvent<HTMLButtonElement>) => actions.onPickUpstream?.(event.currentTarget) }, 'Pick models'),
}));

vi.mock('../src/components/ui/input.js', () => ({
  Input: ({ onChange, ...props }: ComponentProps<'input'>) =>
    h('input', { ...props, onInput: onChange as ComponentProps<'input'>['onInput'] }),
}));

class TestEvent {
  target: ElementNode | null = null;
  defaultPrevented = false;
  stopped = false;
  readonly button = 0;
  readonly bubbles = true;
  readonly cancelable = true;

  constructor(
    readonly type: string,
    readonly options: { detail?: number; key?: string; pointerId?: number; clientY?: number } = {},
  ) {}

  get detail() { return this.options.detail ?? 0; }
  get key() { return this.options.key; }
  get pointerId() { return this.options.pointerId ?? 1; }
  get pointerType() { return 'mouse'; }
  get clientX() { return 100; }
  get clientY() { return this.options.clientY ?? 0; }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this.stopped = true; }
}

class TextNode {
  readonly nodeType = 3;
  parentNode: ElementNode | null = null;
  constructor(public textContent: string) {}
}

class ElementNode {
  nodeType = 1;
  readonly namespaceURI = 'http://www.w3.org/1999/xhtml';
  readonly childNodes: Array<ElementNode | TextNode> = [];
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, Set<(event: TestEvent) => void>>();
  readonly style = {};
  parentNode: ElementNode | null = null;
  ownerDocument: DocumentNode | null = null;
  type = '';
  value = '';
  defaultValue = '';
  defaultChecked = false;
  scrollTop = 0;
  private checkedValue = false;

  constructor(readonly tagName: string) {}

  get nodeName() { return this.tagName; }
  get parentElement() { return this.parentNode; }
  get firstChild() { return this.childNodes[0] ?? null; }
  get id() { return this.getAttribute('id') ?? ''; }
  set id(id: string) { this.setAttribute('id', id); }
  get checked() { return this.checkedValue; }
  set checked(value: boolean) { this.checkedValue = value; }
  get textContent() { return this.childNodes.map((child) => child.textContent).join(''); }
  set textContent(text: string) {
    this.childNodes.splice(0);
    if (text) this.appendChild(new TextNode(text));
  }

  getAttribute(key: string) { return this.attributes.get(key) ?? null; }
  hasAttribute(key: string) { return this.attributes.has(key); }
  getBoundingClientRect() { return { top: 0, bottom: 0 }; }
  get isConnected() { return this.ownerDocument?.contains(this) ?? false; }
  focus = vi.fn((_options?: FocusOptions) => {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  });
  contains(node: ElementNode) { return descendants(this).includes(node); }
  matches(selector: string) {
    const match = /^\[([^=]+)="([^"]+)"\]$/.exec(selector);
    return match !== null && this.getAttribute(match[1]!) === match[2];
  }
  querySelectorAll(selector: string) {
    return descendants(this).slice(1).filter((node) => node.matches(selector));
  }
  closest(selector: string): ElementNode | null {
    return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null;
  }
  setAttribute(key: string, value: string) {
    this.attributes.set(key, String(value));
    if (key === 'type') this.type = value;
  }
  removeAttribute(key: string) { this.attributes.delete(key); }
  appendChild(node: ElementNode | TextNode) { this.insertBefore(node, null); }
  insertBefore(node: ElementNode | TextNode, sibling: ElementNode | TextNode | null) {
    node.parentNode?.removeChild(node);
    node.parentNode = this;
    const index = sibling === null ? this.childNodes.length : this.childNodes.indexOf(sibling);
    this.childNodes.splice(index, 0, node);
  }
  removeChild(node: ElementNode | TextNode) {
    this.childNodes.splice(this.childNodes.indexOf(node), 1);
    node.parentNode = null;
  }
  addEventListener(type: string, listener: (event: TestEvent) => void, capture = false) {
    const key = `${type}:${capture}`;
    if (!this.listeners.has(key)) this.listeners.set(key, new Set());
    this.listeners.get(key)?.add(listener);
  }
  removeEventListener(type: string, listener: (event: TestEvent) => void, capture = false) {
    this.listeners.get(`${type}:${capture}`)?.delete(listener);
  }
  dispatchEvent(event: TestEvent) {
    event.target = this;
    const path: ElementNode[] = [];
    for (let node: ElementNode | null = this; node; node = node.parentNode) path.push(node);
    const checkbox = event.type === 'click' && this.type === 'checkbox';
    const before = this.checkedValue;
    if (checkbox) this.checkedValue = !before;
    for (const capture of [true, false]) {
      for (const node of capture ? [...path].reverse() : path) {
        if (event.stopped) break;
        for (const listener of node.listeners.get(`${event.type}:${capture}`) ?? []) listener(event);
      }
    }
    if (checkbox && event.defaultPrevented) this.checkedValue = before;
    if (event.type === 'click' && !event.defaultPrevented && !checkbox) {
      const label = path.find((node) => node.tagName === 'LABEL');
      const controlId = label?.getAttribute('for');
      if (controlId) {
        this.ownerDocument?.findId(controlId)?.dispatchEvent(new TestEvent('click'));
      }
    }
    return !event.defaultPrevented;
  }
}

function descendants(node: ElementNode): ElementNode[] {
  return [node, ...node.childNodes.flatMap((child) => child instanceof ElementNode ? descendants(child) : [])];
}

class DocumentNode extends ElementNode {
  readonly defaultView = globalThis;
  readonly body = this.createElement('body');
  readonly documentElement = this.createElement('html');
  activeElement: ElementNode | null = null;
  elementFromPoint(_x: number, _y: number): ElementNode | null { return null; }

  constructor() {
    super('#document');
    this.nodeType = 9;
    this.appendChild(this.documentElement);
    this.documentElement.appendChild(this.body);
  }

  createElement(tag: string) {
    const element = new ElementNode(tag.toUpperCase());
    element.ownerDocument = this;
    return element;
  }
  createElementNS(_namespace: string, tag: string) { return this.createElement(tag); }
  createTextNode(text: string) { return new TextNode(text); }
  findId(id: string) { return descendants(this).find((node) => node.id === id); }
}

let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

const models = [
  { id: 'claude-sonnet', name: 'Claude Sonnet' },
  { id: 'gemini-flash', name: 'Gemini Flash' },
  { id: 'gpt-oss', name: 'GPT OSS' },
];
const ids = models.map(({ id }) => id);

type PickerProps = ComponentProps<typeof UpstreamModelPicker>;
type CatalogResult = Awaited<ReturnType<PickerProps['load']>>;

function deferredCatalog() {
  let resolve!: (value: CatalogResult) => void;
  const promise = new Promise<CatalogResult>((settle) => { resolve = settle; });
  return { promise, resolve };
}

async function mount(children: ReactNode) {
  const document = new DocumentNode();
  for (const [name, value] of Object.entries({
    document, window: globalThis, HTMLElement: ElementNode, Element: ElementNode,
    HTMLIFrameElement: class HTMLIFrameElement {}, PointerEvent: TestEvent, IS_REACT_ACT_ENVIRONMENT: true,
  })) vi.stubGlobal(name, value);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const mounted = createRoot(host as unknown as HTMLElement);
  root = mounted;
  await act(async () => {
    mounted.render(h(I18nProvider, { initialLocale: 'en', children }));
  });
  const nodes = () => descendants(host);
  const byTestId = (id: string) => nodes().filter((node) => node.getAttribute('data-testid') === id);
  const rows = () => byTestId('upstream-model');
  const row = (id: string) => rows().find((node) => node.getAttribute('data-model-id') === id)!;
  const box = (node: ElementNode) => descendants(node).find((child) => child.getAttribute('role') === 'checkbox')!;
  const click = (node: ElementNode, detail = 1) => act(async () => {
    flushSync(() => node.dispatchEvent(new TestEvent('click', { detail })));
  });
  const field = (label: string) => nodes().find((node) => node.getAttribute('aria-label') === label)!;
  const input = (label: string, value: string, enter = false) => act(async () => {
    const node = field(label);
    node.value = value;
    flushSync(() => node.dispatchEvent(new TestEvent('input')));
    if (enter) flushSync(() => node.dispatchEvent(new TestEvent('keydown', { key: 'Enter' })));
  });
  return {
    nodes, byTestId, rows, row, box, click, field, input,
    button: (text: string) => click(nodes().find((node) => node.tagName === 'BUTTON' && node.textContent === text)!),
    order: () => rows().map((node) => node.getAttribute('data-model-id')),
    checked: () => rows().filter((node) => box(node).getAttribute('aria-checked') === 'true')
      .map((node) => node.getAttribute('data-model-id')),
    add: (id: string) => input('Model ID', id, true),
    search: (query: string) => input('Search models', query),
  };
}

async function render(overrides: Partial<PickerProps> = {}) {
  const onSave = vi.fn();
  const picker = await mount(h(UpstreamModelPicker, {
    endpoint: 'https://models.example.test/v1/models', selected: [],
    load: async (): Promise<CatalogResult> => ({ status: 'ok', models }),
    onClose: vi.fn(), onSave, ...overrides,
  }));
  return {
    ...picker,
    save: async () => {
      await picker.click(picker.byTestId('upstream-save')[0]!);
      return onSave.mock.lastCall?.[0];
    },
    retry: () => picker.button('Retry'),
  };
}

function rowProvenance(row: ElementNode) {
  return descendants(row).find((node) => node.getAttribute('data-testid') === 'upstream-provenance')!;
}

function textWithoutProvenance(node: ElementNode | TextNode): string {
  if (node instanceof TextNode) return node.textContent;
  if (node.getAttribute('data-testid') === 'upstream-provenance') return '';
  return node.childNodes.map(textWithoutProvenance).join('');
}

function snapshotRetrySettlement(picker: Awaited<ReturnType<typeof render>>) {
  const rows = picker.rows().map((node) => ({
    node, text: textWithoutProvenance(node), title: node.getAttribute('title'),
  }));
  const field = picker.field('Model ID');
  const value = field.value;
  const tree = picker.nodes().map((node) => {
    const children = node.getAttribute('data-testid') === 'upstream-provenance'
      ? node.childNodes.filter((child) => child instanceof ElementNode)
      : [...node.childNodes];
    return {
      node,
      parent: node.parentNode,
      children,
      text: children.flatMap((child) => child instanceof TextNode ? [[child, child.textContent] as const] : []),
    };
  });
  const existing = new Set(tree.map(({ node }) => node));
  return () => {
    const afterRows = picker.rows();
    for (const [index, { node, text, title }] of rows.entries()) {
      const id = node.getAttribute('data-model-id');
      expect(afterRows[index] === node, `row ${id} stays at its position`).toBe(true);
      expect(textWithoutProvenance(node), `row ${id} keeps its metadata text`).toBe(text);
      expect(node.getAttribute('title'), `row ${id} keeps its description`).toBe(title);
    }
    expect(picker.field('Model ID') === field, 'the manual field stays mounted').toBe(true);
    expect(field.value).toBe(value);
    const after = picker.nodes().filter((node) => existing.has(node));
    expect(after.length, 'every existing element stays mounted').toBe(tree.length);
    for (const [index, { node, parent, children, text }] of tree.entries()) {
      expect(after[index] === node && node.parentNode === parent, `${node.tagName} stays in place`).toBe(true);
      const originalChildren = node.childNodes.filter((child) => children.includes(child));
      expect(originalChildren).toHaveLength(children.length);
      expect(originalChildren.every((child, i) => child === children[i])).toBe(true);
      for (const [child, content] of text) expect(child.textContent).toBe(content);
    }
  };
}

const pickerKinds = [
  ['ungrouped', undefined],
  ['Antigravity', groupAntigravityUpstream],
  ['Devin', groupDevinUpstream],
] as const;

describe('deriveModelSource', () => {
  it.each([
    [false, false, false, 'upstream'],
    [false, false, true, 'fallback'],
    [false, true, false, 'upstream'],
    [false, true, true, 'fallback'],
    [true, false, false, 'missing'],
    [true, false, true, 'missing'],
    [true, true, false, 'upstream'],
    [true, true, true, 'upstream'],
  ] as const)('derives %s/%s/%s as %s', (hasSuccess, inLatestList, everReturned, source) => {
    expect(deriveModelSource(hasSuccess, inLatestList, everReturned)).toBe(source);
  });
});

const provenanceSequences = [
  {
    name: 'fallback/success/fallback',
    steps: [
      { result: { status: 'fallback', models: [models[0]!], failure: 'network', httpStatus: null }, sources: ['fallback', 'upstream'] },
      { result: { status: 'ok', models: [models[0]!] }, sources: ['upstream', 'missing'] },
      { result: { status: 'fallback', models: [models[0]!, models[1]!], failure: 'timeout', httpStatus: null }, sources: ['upstream', 'missing', 'missing'] },
    ],
  },
  {
    name: 'success/fallback',
    steps: [
      { result: { status: 'ok', models: [models[0]!] }, sources: ['upstream', 'missing'] },
      { result: { status: 'fallback', models: [models[0]!, models[1]!], failure: 'timeout', httpStatus: null }, sources: ['upstream', 'missing', 'missing'] },
    ],
  },
  {
    name: 'fallback/failure/success',
    steps: [
      { result: { status: 'fallback', models: [models[0]!], failure: 'network', httpStatus: null }, sources: ['fallback', 'upstream'] },
      { result: { status: 'failed', failure: 'timeout', httpStatus: null }, sources: ['fallback', 'upstream'] },
      { result: { status: 'ok', models: [models[0]!] }, sources: ['upstream', 'missing'] },
    ],
  },
  {
    name: 'success/success-with-omission/fallback',
    steps: [
      { result: { status: 'ok', models: [models[0]!] }, sources: ['upstream', 'missing'] },
      { result: { status: 'ok', models: [] }, sources: ['missing', 'missing'] },
      { result: { status: 'fallback', models: [models[0]!, models[1]!], failure: 'timeout', httpStatus: null }, sources: ['missing', 'missing', 'missing'] },
    ],
  },
] satisfies { name: string; steps: { result: CatalogResult; sources: string[] }[] }[];

it.each(provenanceSequences)('derives sources from response facts throughout $name', ({ steps }) => {
  const returnedIds = new Set<string>();
  const rowIds = new Set([ids[0]!, 'custom-preview']);
  let latestSuccessfulIds: Set<string> | null = null;
  for (const { result, sources } of steps) {
    if (result.status !== 'failed') {
      for (const { id } of result.models) {
        returnedIds.add(id);
        rowIds.add(id);
      }
      if (result.status === 'ok') latestSuccessfulIds = new Set(result.models.map(({ id }) => id));
    }
    expect([...rowIds].map((id) => deriveModelSource(
      latestSuccessfulIds !== null,
      latestSuccessfulIds?.has(id) ?? false,
      returnedIds.has(id),
    ))).toEqual(sources);
  }
});

describe('upstream model picker', () => {
  describe.each(pickerKinds)('%s provenance sequences', (_kind, groupModels) => {
    it.each(provenanceSequences)('derives row sources throughout $name', async ({ steps }) => {
      const load = vi.fn<PickerProps['load']>()
        .mockResolvedValueOnce({ status: 'failed', failure: 'network', httpStatus: null });
      for (const { result } of steps) load.mockResolvedValueOnce(result);
      const picker = await render({ load, groupModels, selected: [ids[0]!] });
      await picker.add('custom-preview');
      expect(picker.rows().map((row) => row.getAttribute('data-model-source'))).toEqual(['upstream', 'upstream']);
      const originalRows = picker.rows();
      for (const { sources } of steps) {
        const assertAppendOnly = snapshotRetrySettlement(picker);
        await picker.retry();
        assertAppendOnly();
        expect(picker.rows().slice(0, originalRows.length)).toEqual(originalRows);
        expect(picker.rows().map((row) => row.getAttribute('data-model-source'))).toEqual(sources);
        for (const [index, row] of picker.rows().entries()) {
          const mark = rowProvenance(row);
          const source = sources[index];
          const text = source === 'fallback' ? 'Fallback list, not from the upstream'
            : source === 'missing' ? 'Not in the latest list' : '';
          expect(mark.textContent).toBe(text);
          expect(mark.getAttribute('title')).toBe(text === '' ? null : text);
          expect(picker.box(row).getAttribute('aria-describedby')).toBe(text === '' ? null : mark.id);
        }
        expect(await picker.save()).toEqual([ids[0], 'custom-preview']);
      }
    });
  });

  it.each(pickerKinds)('keeps successive clicks on different row positions in the %s list', async (_kind, groupModels) => {
    const picker = await render(groupModels ? { groupModels } : {});
    expect(picker.order()).toEqual(ids);
    await picker.click(picker.rows()[2]!);
    await picker.click(picker.rows()[1]!);
    expect(picker.checked()).toEqual([ids[1], ids[2]]);
    expect(picker.order()).toEqual(ids);
    expect(await picker.save()).toEqual([ids[2], ids[1]]);
  });

  it('counts each direct box, ID and name click exactly once', async () => {
    const picker = await render();
    const id = models[2]!.id;
    await picker.click(picker.box(picker.row(id)));
    expect(picker.checked()).toEqual([id]);
    await picker.click(descendants(picker.row(id)).find((node) => node.tagName === 'CODE')!);
    expect(picker.checked()).toEqual([]);
    await picker.click(descendants(picker.row(id)).find((node) => node.textContent === models[2]!.name)!);
    expect(picker.checked()).toEqual([id]);
  });

  it('counts both clicks of a double click at the same box position', async () => {
    const picker = await render({ selected: [ids[1]!] });
    const order = picker.order();
    const position = 2;
    const id = order[position];
    await picker.click(picker.box(picker.rows()[position]!));
    expect(picker.checked()).toContain(id);
    const target = picker.box(picker.rows()[position]!);
    await picker.click(target, 2);
    await act(() => { target.dispatchEvent(new TestEvent('dblclick', { detail: 2 })); });
    expect(picker.checked()).toEqual([ids[1]]);
    expect(picker.order()).toEqual(order);
  });

  it('keeps row clicks active during retry and appends new catalog IDs on settlement', async () => {
    const retry = deferredCatalog();
    const load = vi.fn(() => retry.promise).mockResolvedValueOnce({
      status: 'fallback', models: models.slice(0, 2), failure: 'network', httpStatus: null,
    });
    const picker = await render({ load });
    expect(picker.order()).toEqual(ids.slice(0, 2));
    await picker.retry();
    expect(picker.order()).toEqual(ids.slice(0, 2));
    await picker.click(picker.rows()[1]!);
    await picker.click(picker.rows()[0]!);
    expect(picker.checked()).toEqual(ids.slice(0, 2));
    await act(async () => {
      retry.resolve({ status: 'ok', models: [models[1]!, models[0]!, models[2]!] });
    });
    expect(picker.order()).toEqual(ids);
    expect(picker.checked()).toEqual(ids.slice(0, 2));
  });

  const firstModel = { ...models[0]!, costSummary: 'Standard pricing', costTier: 'Free', contextTokens: 200_000 };
  const extra = { id: 'claude-opus', name: 'Claude Opus' };
  const retryCases = [
    ['success with an omitted row', { status: 'ok', models: [...models.slice(1), extra] }, extra.id, 1],
    ['success with a renamed row', { status: 'ok', models: [{ ...firstModel, name: 'Sonnet Preview', costSummary: 'New pricing' }, ...models.slice(1)] }, null, 0],
    ['fallback with a name equal to its ID', { status: 'fallback', models: [{ id: firstModel.id, name: firstModel.id }, models[1]!, extra], failure: 'timeout', httpStatus: 504 }, extra.id, 0],
    ['explicit failure', { status: 'failed', failure: 'timeout', httpStatus: 504 }, null, 0],
    ['success with an empty list', { status: 'ok', models: [] }, null, 3],
    ['success with unchanged rows', { status: 'ok', models: [firstModel, ...models.slice(1)] }, null, 0],
  ] satisfies [string, CatalogResult, string | null, number][];

  it.each(retryCases)('only appends on %s and keeps an unsubmitted manual ID', async (_case, result, appended, omitted) => {
    const retry = deferredCatalog();
    const load = vi.fn(() => retry.promise).mockResolvedValueOnce({
      status: 'fallback', models: [firstModel, ...models.slice(1)], failure: 'network', httpStatus: null,
    });
    const picker = await render({ load, groupModels: groupAntigravityUpstream });
    await picker.retry();
    await picker.input('Model ID', 'custom-vision');
    const field = picker.field('Model ID');
    const expectAppendOnly = snapshotRetrySettlement(picker);
    await act(async () => retry.resolve(result));
    expectAppendOnly();
    const omissions = picker.nodes()
      .filter((node) => node.getAttribute('role') === 'status')
      .flatMap((node) => node.childNodes.slice(1).map((line) => line.textContent));
    expect(omissions).toEqual(result.status === 'ok' ? [`Refresh 1: not listed upstream (${omitted})`] : []);
    expect(picker.order()).toEqual(appended === null ? ids : [...ids, appended]);
    if (appended !== null) {
      expect(picker.row(appended).parentNode).not.toBe(picker.row(firstModel.id).parentNode);
    }
    await act(() => { field.dispatchEvent(new TestEvent('keydown', { key: 'Enter' })); });
    expect(await picker.save()).toEqual(['custom-vision']);
  });

  it('keeps the initial focus target at the search field throughout initial loading', async () => {
    const initial = deferredCatalog();
    const picker = await render({ load: () => initial.promise });
    expect(picker.byTestId('upstream-loading')).toHaveLength(1);
    const search = picker.field('Search models');
    expect(search).toBeDefined();
    const initialFocus = dialogFocus.initialFocus;
    expect(initialFocus).toEqual({ current: search });
    expect(picker.nodes().indexOf(search)).toBeLessThan(
      picker.nodes().indexOf(picker.byTestId('upstream-loading')[0]!),
    );
    await act(async () => initial.resolve({ status: 'ok', models }));
    expect(picker.field('Search models')).toBe(search);
    expect(dialogFocus.initialFocus).toBe(initialFocus);
    expect(initialFocus).toEqual({ current: search });
    expect(picker.order()).toEqual(ids);
  });

  it.each([
    { scene: 'visible after scrolling', scrollTop: 128, focus: 'search' as const },
    { scene: 'focused and visible after scrolling', scrollTop: 128, focus: 'manual' as const },
    { scene: 'below the scrollport', scrollTop: 32, focus: 'search' as const },
    { scene: 'visible without scrolling', scrollTop: 0, focus: 'manual' as const },
  ])('never anchors initial settlement to the manual field when it is $scene', async ({ scrollTop, focus }) => {
    const initial = deferredCatalog();
    const picker = await render({ load: () => initial.promise, selected: ['local-opus', 'local-haiku'] });
    const body = picker.byTestId('dialog-body')[0]!;
    const field = picker.field('Model ID');
    body.scrollTop = scrollTop;
    const viewportTop = 80;
    const viewportHeight = scrollTop === 0 ? 400 : 144;
    Object.assign(body, {
      getBoundingClientRect: () => ({ top: viewportTop, bottom: viewportTop + viewportHeight }),
    });
    const fieldBounds = () => {
      const listHeight = Math.max(160, 48 * (picker.rows().length + picker.byTestId('upstream-group').length));
      const top = viewportTop + 72 + listHeight - body.scrollTop;
      return { top, bottom: top + 32 };
    };
    Object.assign(field, { getBoundingClientRect: fieldBounds });
    body.ownerDocument!.activeElement = focus === 'manual' ? field : picker.field('Search models');
    await act(async () => initial.resolve({ status: 'ok', models: [models[0]!] }));
    expect(picker.rows()).toHaveLength(3);
    expect(picker.byTestId('upstream-group')).toHaveLength(2);
    expect(body.scrollTop).toBe(scrollTop);
  });

  it.each([
    { scene: 'pressed row over focused manual field', pointer: 'pointerdown', focus: 'manual', delta: 12 },
    { scene: 'hovered row over focused manual field', pointer: 'pointermove', focus: 'manual', delta: 12 },
    { scene: 'pointer canceled over a row', pointer: 'pointerdown', end: 'pointercancel', focus: 'manual', delta: 0 },
    { scene: 'pointer leaves the body', pointer: 'pointermove', end: 'pointerleave', focus: 'manual', delta: 0 },
    { scene: 'pointer over the focused manual field', pointer: 'pointermove', target: 'manual', focus: 'manual', delta: 0 },
    { scene: 'focused row over the visible manual field', focus: 'row', delta: 12 },
    { scene: 'focused row below the viewport', focus: 'offscreen row', delta: 0 },
    { scene: 'focused manual field visible after scrolling', focus: 'manual', delta: 0 },
    { scene: 'focused manual field visible at scrollTop zero', focus: 'manual', scroll: 0, delta: 0 },
    { scene: 'focused manual field below the viewport', focus: 'manual', fieldTop: 230, displacement: 0, delta: 0 },
    { scene: 'pointer over a row after scrolling the focused field away', pointer: 'pointermove', focus: 'manual', fieldTop: 230, displacement: 0, delta: 0 },
    { scene: 'unfocused rows and manual field', delta: 0 },
  ])('anchors retry settlement only to a visible hovered or focused row: $scene', async ({
    pointer, end, target, focus, fieldTop = 208, displacement = 12, scroll = 140, delta,
  }) => {
    const retry = deferredCatalog();
    const load = vi.fn(() => retry.promise).mockResolvedValueOnce({
      status: 'fallback', models, failure: 'network', httpStatus: null,
    });
    const picker = await render({ load });
    await picker.retry();
    const body = picker.byTestId('dialog-body')[0]!;
    const field = picker.field('Model ID');
    const viewport = { top: 80, bottom: 224 };
    body.scrollTop = scroll;
    Object.assign(body, { getBoundingClientRect: () => viewport });
    const appended = () => picker.rows().length > models.length;
    const bounds = (top: number, height: number) => ({ top, bottom: top + height });
    Object.assign(field, {
      getBoundingClientRect: () => bounds(fieldTop + scroll - body.scrollTop + (appended() ? 96 : 0), 32),
    });
    for (const [index, row] of picker.rows().entries()) {
      Object.assign(row, {
        getBoundingClientRect: () => bounds(
          [80, 156, 250][index]! + scroll - body.scrollTop + (appended() ? displacement : 0), 48,
        ),
      });
    }
    const row = picker.row(ids[1]!);
    const doc = body.ownerDocument!;
    const clientY = target === 'manual' ? fieldTop + 4 : 160;
    doc.elementFromPoint = (_x, y) => {
      if (y < viewport.top || y >= viewport.bottom) return null;
      const fieldRect = field.getBoundingClientRect();
      if (fieldRect.top <= y && y < fieldRect.bottom) return field;
      const hit = picker.rows().find((node) => {
        const { top, bottom } = node.getBoundingClientRect();
        return top <= y && y < bottom;
      });
      return hit ? rowProvenance(hit) : null;
    };
    doc.activeElement = focus === 'manual' ? field : focus === 'row' ? picker.box(row)
      : focus === 'offscreen row' ? picker.box(picker.row(ids[2]!)) : null;
    if (pointer) {
      const pointerTarget = target === 'manual' ? field : rowProvenance(row);
      pointerTarget.dispatchEvent(new TestEvent(pointer, { clientY }));
      doc.body.dispatchEvent(new TestEvent('pointercancel', { pointerId: 2 }));
      if (end) (end === 'pointerleave' ? body.firstChild as ElementNode : doc.body).dispatchEvent(new TestEvent(end));
    }
    await act(async () => retry.resolve({ status: 'ok', models: [...models, { id: 'claude-opus', name: 'Claude Opus' }] }));
    expect(picker.rows()).toHaveLength(models.length + 1);
    expect(body.scrollTop).toBe(scroll + delta);
    if (pointer && !end && target !== 'manual') {
      const hit = doc.elementFromPoint(100, clientY);
      expect(hit?.closest('[data-testid="upstream-model"]')).toBe(row);
      await picker.click(hit!);
      expect(picker.checked()).toEqual([ids[1]]);
    }
  });

  it('shows a manual pick during initial loading so it can be inspected and unchecked before settlement', async () => {
    const initial = deferredCatalog();
    const onSave = vi.fn();
    const picker = await render({ load: () => initial.promise, onSave });
    expect(picker.byTestId('upstream-loading')).toHaveLength(1);
    expect(picker.order()).toEqual([]);

    await picker.add('custom-preview');
    expect(picker.byTestId('upstream-loading')).toHaveLength(1);
    expect(picker.order()).toEqual(['custom-preview']);
    expect(picker.checked()).toEqual(['custom-preview']);
    expect(picker.nodes().indexOf(picker.row('custom-preview'))).toBeLessThan(
      picker.nodes().indexOf(picker.byTestId('upstream-loading')[0]!),
    );

    const customRow = picker.row('custom-preview');
    await picker.click(picker.box(customRow));
    expect(picker.order()).toEqual(['custom-preview']);
    expect(picker.checked()).toEqual([]);
    await picker.save();
    expect(onSave).toHaveBeenLastCalledWith([], new Map(), []);

    await picker.click(picker.box(customRow));
    await picker.add(ids[0]!);
    const matchedRow = picker.row(ids[0]!);
    expect(picker.order()).toEqual(['custom-preview', ids[0]]);
    expect(picker.checked()).toEqual(['custom-preview', ids[0]]);

    await act(async () => initial.resolve({ status: 'ok', models }));
    expect(picker.byTestId('upstream-loading')).toHaveLength(0);
    expect(picker.order()).toEqual(['custom-preview', ...ids]);
    expect(picker.row('custom-preview')).toBe(customRow);
    expect(picker.row(ids[0]!)).toBe(matchedRow);
    expect(customRow.getAttribute('data-model-source')).toBe('missing');
    expect(matchedRow.getAttribute('data-model-source')).toBe('upstream');
    expect(picker.checked()).toEqual(['custom-preview', ids[0]]);
    await picker.save();
    expect(onSave).toHaveBeenLastCalledWith(
      ['custom-preview', ids[0]],
      new Map(models.map((model) => [model.id, model])),
      [],
    );
  });

  it('shows opening selections during initial loading above the loading indicator', async () => {
    const initial = deferredCatalog();
    const picker = await render({ load: () => initial.promise, selected: ['local-opus'] });
    expect(picker.byTestId('upstream-loading')).toHaveLength(1);
    expect(picker.order()).toEqual(['local-opus']);
    expect(picker.checked()).toEqual(['local-opus']);
    expect(picker.nodes().indexOf(picker.row('local-opus'))).toBeLessThan(
      picker.nodes().indexOf(picker.byTestId('upstream-loading')[0]!),
    );
    const openingRow = picker.row('local-opus');
    await picker.click(picker.box(openingRow));
    expect(picker.checked()).toEqual([]);
    await act(async () => initial.resolve({ status: 'ok', models }));
    expect(picker.byTestId('upstream-loading')).toHaveLength(0);
    expect(picker.row('local-opus')).toBe(openingRow);
    expect(picker.order()).toEqual(['local-opus', ...ids]);
    expect(picker.checked()).toEqual([]);
  });

  it('keeps manual entry mounted from initial loading through success', async () => {
    const initial = deferredCatalog();
    const picker = await render({ load: () => initial.promise });
    expect(picker.byTestId('upstream-loading')).toHaveLength(1);
    const field = picker.field('Model ID');
    expect(field).toBeDefined();
    await picker.input('Model ID', 'custom-preview');
    await act(async () => initial.resolve({ status: 'ok', models }));
    expect(picker.field('Model ID') === field).toBe(true);
    expect(field.value).toBe('custom-preview');
    await act(() => { field.dispatchEvent(new TestEvent('keydown', { key: 'Enter' })); });
    expect(await picker.save()).toEqual(['custom-preview']);
  });

  it.each([
    ['Claude', claudeSubscriptionModelSchema.shape.id],
    ['Devin', devinSubscriptionModelSchema.shape.id],
    ['Antigravity', antigravitySubscriptionModelSchema.shape.id],
  ] as const)('clears the %s manual error after correction and accepts the trimmed boundary ID', async (_vendor, modelIdSchema) => {
    const picker = await render({ modelIdSchema });
    await picker.add('x'.repeat(257));
    expect(picker.field('Model ID').getAttribute('aria-invalid')).toBe('true');
    expect(picker.byTestId('upstream-save')[0]!.hasAttribute('disabled')).toBe(true);
    expect(await picker.save()).toBeUndefined();
    await picker.add(` ${'x'.repeat(256)} `);
    expect(picker.field('Model ID').getAttribute('aria-invalid')).toBeNull();
    expect(picker.field('Model ID').getAttribute('aria-describedby')).toBeNull();
    expect(picker.nodes().filter((node) => node.getAttribute('data-slot') === 'field-error')).toHaveLength(0);
    expect(picker.field('Model ID').value).toBe('');
    expect(await picker.save()).toEqual(['x'.repeat(256)]);
  });

  it.each([
    ['custom provider', undefined],
    ['Devin', devinSubscriptionModelSchema.shape.id],
    ['Antigravity', antigravitySubscriptionModelSchema.shape.id],
  ] as const)('preserves manual ID formats accepted by the %s PATCH schema', async (_vendor, modelIdSchema) => {
    const picker = await render({ modelIdSchema });
    await picker.add(' custom model ');
    expect(picker.field('Model ID').getAttribute('aria-invalid')).toBeNull();
    expect(await picker.save()).toEqual(['custom model']);
  });

  it('honors a friendly-name press when retry returns only its ID as the name', async () => {
    const retry = deferredCatalog();
    const load = vi.fn(() => retry.promise).mockResolvedValueOnce({
      status: 'fallback', models, failure: 'network', httpStatus: null,
    });
    const picker = await render({ load });
    const model = models[0]!;
    const name = () => descendants(picker.row(model.id)).find((node) => node.textContent === model.name);
    const target = name()!;
    await picker.retry();
    await act(() => { target.dispatchEvent(new TestEvent('pointerdown')); });
    expect(picker.checked()).toEqual([]);
    await act(async () => retry.resolve({ status: 'ok', models: [{ id: model.id, name: model.id }] }));
    expect(name() === target, 'the name remains the release target').toBe(true);
    await act(() => { target.dispatchEvent(new TestEvent('pointerup')); });
    await picker.click(target);
    expect(await picker.save()).toEqual([model.id]);
  });

  it.each(['checkbox', 'ID', 'name'] as const)(
    'honors a press on the %s released after retry commits a list missing the row',
    async (targetKind) => {
      const retry = deferredCatalog();
      const load = vi.fn(() => retry.promise).mockResolvedValueOnce({
        status: 'fallback', models, failure: 'network', httpStatus: null,
      });
      const model = models[0]!;
      const picker = await render({ load });
      const row = picker.row(model.id);
      const box = picker.box(row);
      const target = targetKind === 'checkbox' ? box : descendants(row).find((node) =>
        targetKind === 'ID' ? node.tagName === 'CODE' : node.textContent === model.name,
      )!;
      await picker.retry();
      expect(box.getAttribute('data-disabled')).toBeNull();
      await act(() => {
        target.dispatchEvent(new TestEvent('pointerdown'));
        target.dispatchEvent(new TestEvent('mousedown'));
      });
      expect(picker.checked()).toEqual([]);
      await act(async () => {
        retry.resolve({ status: 'ok', models: models.slice(1) });
      });
      expect(picker.byTestId('upstream-fallback')).toHaveLength(1);
      expect(picker.row(model.id)).toBe(row);
      expect(picker.box(row)).toBe(box);
      await act(() => {
        target.dispatchEvent(new TestEvent('pointerup'));
        target.dispatchEvent(new TestEvent('mouseup'));
      });
      await picker.click(target);
      expect(picker.checked()).toEqual([model.id]);
      expect(box.getAttribute('data-disabled')).toBeNull();
      expect(await picker.save()).toEqual([model.id]);
    },
  );

  it('accepts a typed ID that a fallback retry omits', async () => {
    const load = vi.fn<PickerProps['load']>()
      .mockResolvedValueOnce({ status: 'fallback', models, failure: 'network', httpStatus: null })
      .mockResolvedValueOnce({ status: 'fallback', models: models.slice(1), failure: 'timeout', httpStatus: 504 });
    const id = ids[0]!;
    const picker = await render({ load });
    const row = picker.row(id);
    await picker.retry();
    const notices = picker.nodes().filter((node) => node.getAttribute('role') === 'alert');
    expect(notices).toHaveLength(2);
    expect(notices[1]?.getAttribute('title')).toBe('HTTP 504');
    expect(row.getAttribute('data-model-source')).toBe('fallback');
    expect(rowProvenance(row).textContent).toBe('Fallback list, not from the upstream');
    expect(picker.checked()).toEqual([]);
    await picker.add(` ${id} `);
    expect(picker.checked()).toEqual([id]);
    expect(picker.row(id)).toBe(row);
    expect(picker.order()).toEqual(ids);
    expect(await picker.save()).toEqual([id]);
  });

  it('restores a checked row missing from the latest list on the second press', async () => {
    const load = vi.fn<PickerProps['load']>()
      .mockResolvedValueOnce({ status: 'fallback', models, failure: 'network', httpStatus: null })
      .mockResolvedValueOnce({ status: 'ok', models: models.slice(1) });
    const id = ids[0]!;
    const picker = await render({ load, selected: [id] });
    await picker.retry();
    const row = picker.row(id);
    const box = picker.box(row);
    expect(row.textContent).toContain(models[0]!.name);
    expect(box.getAttribute('data-disabled')).toBeNull();
    await picker.click(box);
    expect(picker.checked()).toEqual([]);
    expect(box.getAttribute('data-disabled')).toBeNull();
    await picker.click(box, 2);
    expect(picker.checked()).toEqual([id]);
    expect(await picker.save()).toEqual([id]);
  });

  it('retains omitted rows with their original metadata and saves only checked IDs', async () => {
    const first = { ...models[0]!, costTier: 'Free', contextTokens: 200_000 };
    const load = vi.fn<PickerProps['load']>()
      .mockResolvedValueOnce({ status: 'fallback', models: [first, ...models.slice(1)], failure: 'network', httpStatus: null })
      .mockResolvedValueOnce({ status: 'ok', models: [models[1]!] });
    const picker = await render({ load });
    const before = picker.rows();
    await picker.click(picker.row(ids[2]!));
    await picker.retry();
    expect(picker.order()).toEqual(ids);
    for (const [index, row] of before.entries()) expect(picker.rows()[index]).toBe(row);
    expect(textWithoutProvenance(picker.row(first.id))).toBe(`${first.id}${first.name}Free200K`);
    expect(picker.byTestId('upstream-model-free')).toHaveLength(1);
    expect(textWithoutProvenance(picker.row(ids[2]!))).toBe(`${ids[2]}${models[2]!.name}`);
    expect(picker.checked()).toEqual([ids[2]]);
    await picker.click(picker.box(picker.row(first.id)));
    await picker.click(picker.box(picker.row(ids[2]!)));
    expect(picker.checked()).toEqual([first.id]);
    expect(await picker.save()).toEqual([first.id]);
  });

  it.each(pickerKinds)('carries fallback provenance into every selected-on-open row in the %s list', async (_kind, groupModels) => {
    const picker = await render({
      selected: ids,
      groupModels,
      load: async () => ({ status: 'fallback', models, failure: 'network', httpStatus: null }),
    });
    expect(picker.byTestId('upstream-group').map((node) => node.textContent)).toEqual(['Selected on open']);
    expect(picker.order()).toEqual(ids);
    for (const row of picker.rows()) {
      expect(row.getAttribute('data-model-source')).toBe('fallback');
      const marks = descendants(row).filter((node) => node.getAttribute('data-testid') === 'upstream-provenance');
      expect(marks).toHaveLength(1);
      expect(marks[0]?.textContent).toBe('Fallback list, not from the upstream');
      expect(marks[0]?.getAttribute('class')).toContain('text-meta');
      expect(marks[0]?.getAttribute('class')).toContain('text-content-tertiary');
    }
    expect(await picker.save()).toEqual(ids);
  });

  it('gives each ungrouped fallback row one single-line description and keeps the heading plain', async () => {
    const picker = await render({
      load: async () => ({ status: 'fallback', models, failure: 'network', httpStatus: null }),
    });
    expect(picker.byTestId('upstream-group')[0]?.textContent).toBe('Other upstream models');
    expect(picker.byTestId('upstream-provenance')).toHaveLength(ids.length);
    for (const row of picker.rows()) {
      const mark = rowProvenance(row);
      expect(row.getAttribute('data-model-source')).toBe('fallback');
      expect(mark.textContent).toBe('Fallback list, not from the upstream');
      expect(mark.getAttribute('title')).toBe(mark.textContent);
      expect(picker.box(row).getAttribute('aria-describedby')).toBe(mark.id);
      expect(mark.getAttribute('class')?.split(' ')).toEqual(expect.arrayContaining(['h-lh', 'truncate', 'text-meta', 'text-content-tertiary']));
    }
  });

  it.each(pickerKinds)('swaps source text in place on a mixed %s group without changing its heading', async (_kind, groupModels) => {
    const first = { id: 'claude-sonnet', name: 'Claude Sonnet' };
    const second = { id: 'claude-opus', name: 'Claude Opus' };
    const load = vi.fn<PickerProps['load']>()
      .mockResolvedValueOnce({ status: 'fallback', models: [first, second], failure: 'network', httpStatus: null })
      .mockResolvedValueOnce({ status: 'ok', models: [first] });
    const picker = await render({ load, groupModels });
    const rows = picker.rows();
    const heading = picker.byTestId('upstream-group')[0];
    const headingText = heading?.textContent;
    const marks = rows.map(rowProvenance);
    expect(marks.map((mark) => mark?.textContent)).toEqual(Array(2).fill('Fallback list, not from the upstream'));
    await picker.retry();
    expect(picker.rows()).toEqual(rows);
    expect(picker.row(first.id).getAttribute('data-model-source')).toBe('upstream');
    expect(picker.row(second.id).getAttribute('data-model-source')).toBe('missing');
    expect(picker.byTestId('upstream-group')[0]).toBe(heading);
    expect(heading?.textContent).toBe(headingText);
    expect(rowProvenance(picker.row(first.id))).toBe(marks[0]);
    expect(rowProvenance(picker.row(second.id))).toBe(marks[1]);
    expect(marks.map((mark) => mark.textContent)).toEqual(['', 'Not in the latest list']);
    await picker.search('opus');
    expect(picker.byTestId('upstream-provenance')).toEqual([marks[1]]);
  });

  it.each(pickerKinds)('marks omitted selected-on-open rows even on an empty %s retry', async (_kind, groupModels) => {
    const load = vi.fn<PickerProps['load']>()
      .mockResolvedValueOnce({ status: 'fallback', models, failure: 'network', httpStatus: null })
      .mockResolvedValueOnce({ status: 'ok', models: [models[0]!] })
      .mockResolvedValueOnce({ status: 'ok', models: [] });
    const picker = await render({ load, selected: ids, groupModels });
    const rows = picker.rows();
    await picker.retry();
    expect(picker.rows()).toEqual(rows);
    expect(picker.rows().map((row) => row.getAttribute('data-model-source'))).toEqual(['upstream', 'missing', 'missing']);
    expect(rowProvenance(picker.row(ids[0]!)).textContent).toBe('');
    await picker.retry();
    expect(picker.rows().map((row) => row.getAttribute('data-model-source'))).toEqual(['missing', 'missing', 'missing']);
    expect(picker.byTestId('upstream-provenance').map((mark) => mark.textContent)).toEqual(Array(3).fill('Not in the latest list'));
    expect(await picker.save()).toEqual(ids);
  });

  it('carries retry provenance onto a typed row without replacing its ID target', async () => {
    const load = vi.fn<PickerProps['load']>()
      .mockResolvedValueOnce({ status: 'failed', failure: 'network', httpStatus: null })
      .mockResolvedValueOnce({ status: 'fallback', models: [models[0]!], failure: 'timeout', httpStatus: 504 })
      .mockResolvedValueOnce({ status: 'ok', models: [models[0]!] });
    const picker = await render({ load });
    await picker.add(ids[0]!);
    const row = picker.row(ids[0]!);
    const target = descendants(row).find((node) => node.tagName === 'CODE');
    const mark = rowProvenance(row);
    expect(mark?.textContent).toBe('');
    await picker.retry();
    expect(picker.row(ids[0]!)).toBe(row);
    expect(descendants(row).some((node) => node === target)).toBe(true);
    expect(row.getAttribute('data-model-source')).toBe('fallback');
    expect(rowProvenance(row)).toBe(mark);
    expect(mark.textContent).toBe('Fallback list, not from the upstream');
    await picker.retry();
    expect(row.getAttribute('data-model-source')).toBe('upstream');
    expect(rowProvenance(row)).toBe(mark);
    expect(mark.textContent).toBe('');
    expect(descendants(row).some((node) => node === target)).toBe(true);
  });

  it('keeps fallback rows labeled as fallback when retry fails outright', async () => {
    const load = vi.fn<PickerProps['load']>()
      .mockResolvedValueOnce({ status: 'fallback', models, failure: 'network', httpStatus: null })
      .mockResolvedValueOnce({ status: 'failed', failure: 'timeout', httpStatus: null });
    const picker = await render({ load });
    const heading = picker.byTestId('upstream-group')[0]!;
    const label = heading.textContent;
    const row = picker.rows()[0]!;
    await picker.retry();
    expect(picker.byTestId('upstream-error')).toHaveLength(1);
    expect(picker.byTestId('upstream-group')[0]).toBe(heading);
    expect(heading.textContent).toBe(label);
    expect(picker.rows()[0]).toBe(row);
    expect(picker.order()).toEqual(ids);
    expect(picker.rows().map((item) => item.getAttribute('data-model-source'))).toEqual(ids.map(() => 'fallback'));
    expect(picker.byTestId('upstream-provenance').map((mark) => mark.textContent)).toEqual(ids.map(() => 'Fallback list, not from the upstream'));
  });

  it('preserves the opening selections with or without catalog metadata', async () => {
    const load = vi.fn<PickerProps['load']>()
      .mockResolvedValueOnce({ status: 'fallback', models, failure: 'network', httpStatus: null })
      .mockResolvedValueOnce({ status: 'ok', models: [models[1]!] });
    const picker = await render({ load, selected: [ids[0]!, 'custom'] });
    const row = picker.rows()[0]!;
    await picker.retry();
    expect(picker.rows()[0]).toBe(row);
    expect(textWithoutProvenance(row)).toBe(`${ids[0]}${models[0]!.name}`);
    expect(textWithoutProvenance(picker.row('custom'))).toBe('custom');
    expect(rowProvenance(picker.row('custom')).textContent).toBe('Not in the latest list');
    expect(picker.checked()).toEqual([ids[0], 'custom']);
  });

  it.each(['ok', 'fallback', 'empty', 'failed'] as const)('saves session metadata for omitted rows and newest metadata for returned IDs after %s', async (outcome) => {
    const onSave = vi.fn();
    const retained = { ...models[0]!, family: 'Claude', costTier: 'Free', contextTokens: 200_000 };
    const updated = { ...models[1]!, name: 'Gemini Flash Preview', costSummary: 'Updated pricing', contextTokens: 1_000_000 };
    const appended = { id: 'claude-opus', name: 'Claude Opus', costTier: 'High cost' };
    const response: CatalogResult = outcome === 'failed'
      ? { status: 'failed', failure: 'network', httpStatus: null }
      : outcome === 'empty'
        ? { status: 'ok', models: [] }
        : outcome === 'ok'
          ? { status: outcome, models: [updated, appended] }
          : { status: outcome, models: [updated, appended], failure: 'timeout', httpStatus: 504 };
    const load = vi.fn<PickerProps['load']>()
      .mockResolvedValueOnce({ status: 'fallback', models: [retained, ...models.slice(1)], failure: 'network', httpStatus: null })
      .mockResolvedValueOnce(response);
    const picker = await render({ load, onSave });
    const expectAppendOnly = snapshotRetrySettlement(picker);
    await picker.retry();
    expectAppendOnly();
    await picker.click(picker.row(retained.id));
    await picker.click(picker.row(updated.id));
    const metadata = outcome === 'ok' || outcome === 'fallback'
      ? [retained, updated, models[2]!, appended]
      : [retained, ...models.slice(1)];
    await picker.save();
    expect(onSave).toHaveBeenLastCalledWith(
      [retained.id, updated.id],
      new Map(metadata.map((model) => [model.id, model])),
      [],
    );
  });

  it('continues searching rendered names while saving the newest catalog', async () => {
    const onSave = vi.fn();
    const load = vi.fn<PickerProps['load']>()
      .mockResolvedValueOnce({ status: 'fallback', models, failure: 'network', httpStatus: null })
      .mockResolvedValueOnce({ status: 'ok', models: [
        { ...models[0]!, name: 'Renamed' },
        { ...models[1]!, name: 'Sonnet' },
      ] });
    const picker = await render({ load, onSave });
    await picker.search('sonnet');
    const row = picker.rows()[0];
    expect(picker.order()).toEqual([ids[0]]);
    await picker.retry();
    expect(picker.order()).toEqual([ids[0]]);
    expect(picker.rows()[0]).toBe(row);
    await picker.search('sonne');
    expect(picker.order()).toEqual([ids[0]]);
    await picker.click(picker.rows()[0]!);
    await picker.save();
    expect(onSave.mock.lastCall?.[1].get(ids[0])?.name).toBe('Renamed');
    await picker.search('renamed');
    expect(picker.order()).toEqual([]);
  });

  it.each(pickerKinds)('keeps latest-successful membership through fallback-success-fallback in the %s list', async (_kind, groupModels) => {
    const first = models[0]!;
    const second = models[1]!;
    const extra = models[2]!;
    const load = vi.fn<PickerProps['load']>()
      .mockResolvedValueOnce({ status: 'fallback', models: [first], failure: 'network', httpStatus: null })
      .mockResolvedValueOnce({ status: 'ok', models: [second] })
      .mockResolvedValueOnce({ status: 'fallback', models: [first, extra], failure: 'timeout', httpStatus: null })
      .mockResolvedValueOnce({ status: 'failed', failure: 'network', httpStatus: null })
      .mockResolvedValueOnce({ status: 'ok', models: [first, second, extra] });
    const picker = await render({ load, groupModels });
    await picker.click(picker.row(first.id));
    const row = picker.row(first.id);
    const mark = rowProvenance(row);
    expect(mark.textContent).toBe('Fallback list, not from the upstream');
    await picker.retry();
    expect(row.getAttribute('data-model-source')).toBe('missing');
    expect(mark.textContent).toBe('Not in the latest list');
    const assertAppendOnly = snapshotRetrySettlement(picker);
    await picker.retry();
    assertAppendOnly();
    expect(picker.row(first.id)).toBe(row);
    expect(rowProvenance(row)).toBe(mark);
    expect(row.getAttribute('data-model-source')).toBe('missing');
    expect(mark.textContent).toBe('Not in the latest list');
    expect(picker.box(row).getAttribute('aria-describedby')).toBe(mark.id);
    expect(mark.getAttribute('title')).toBe('Not in the latest list');
    expect(picker.row(extra.id).getAttribute('data-model-source')).toBe('missing');
    expect(rowProvenance(picker.row(extra.id)).textContent).toBe('Not in the latest list');
    expect(rowProvenance(picker.row(second.id)).textContent).toBe('');
    await picker.retry();
    expect(mark.textContent).toBe('Not in the latest list');
    expect(await picker.save()).toEqual([first.id]);
    await picker.retry();
    expect(picker.rows().map((model) => model.getAttribute('data-model-source'))).toEqual(['upstream', 'upstream', 'upstream']);
    expect(picker.byTestId('upstream-provenance').map((source) => source.textContent)).toEqual(['', '', '']);
    expect(await picker.save()).toEqual([first.id]);
  });

  it('dates three retries with zero-omission success, fallback and failure outcomes', async () => {
    const load = vi.fn<PickerProps['load']>()
      .mockResolvedValueOnce({ status: 'fallback', models, failure: 'network', httpStatus: null })
      .mockResolvedValueOnce({ status: 'ok', models })
      .mockResolvedValueOnce({ status: 'fallback', models, failure: 'timeout', httpStatus: null })
      .mockResolvedValueOnce({ status: 'failed', failure: 'network', httpStatus: null });
    const picker = await render({ load });
    const opening = picker.byTestId('upstream-fallback')[0]!;
    const openingText = opening.textContent;
    await picker.retry();
    const success = picker.nodes().find((node) => node.getAttribute('role') === 'status')!;
    const successText = success.textContent;
    await picker.retry();
    const fallback = picker.byTestId('upstream-fallback')[1]!;
    const fallbackText = fallback.textContent;
    await picker.retry();
    const failure = picker.byTestId('upstream-error')[0]!;
    expect([success.textContent, fallback.textContent, failure.textContent]).toEqual([
      expect.stringContaining('Refresh 1: not listed upstream (0)'),
      expect.stringContaining('Refresh 2: using the fallback list'),
      expect.stringContaining('Refresh 3: could not fetch the upstream list'),
    ]);
    expect(opening.textContent).toContain('Using the fallback list');
    expect(opening.textContent).not.toContain('Refresh 0');
    expect(success.textContent).toContain('Fetched the upstream model list.');
    expect(opening.textContent).toBe(openingText);
    expect(success.textContent).toBe(successText);
    expect(fallback.textContent).toBe(fallbackText);
    expect(load).toHaveBeenCalledTimes(4);
  });

  it('dates each omission notice and keeps the earlier summary unchanged after IDs return', async () => {
    const load = vi.fn<PickerProps['load']>()
      .mockResolvedValueOnce({ status: 'fallback', models, failure: 'network', httpStatus: null })
      .mockResolvedValueOnce({ status: 'ok', models: [] })
      .mockResolvedValueOnce({ status: 'ok', models });
    const picker = await render({ load, selected: ['local-opus', 'local-haiku'] });
    const expectAppendOnly = snapshotRetrySettlement(picker);
    await picker.retry();
    expectAppendOnly();
    const notices = () => picker.nodes().filter((node) => node.getAttribute('role') === 'status');
    const first = notices()[0]!;
    const firstText = first.textContent;
    const marks = picker.byTestId('upstream-provenance');
    expect(marks.map((mark) => mark.textContent)).toEqual(Array(5).fill('Not in the latest list'));
    const assertFirstUnchanged = snapshotRetrySettlement(picker);
    await picker.retry();
    assertFirstUnchanged();
    expect(notices()).toHaveLength(2);
    expect(notices()[0]).toBe(first);
    expect(first.textContent).toBe(firstText);
    expect(firstText).toContain('The upstream returned an empty list.');
    expect(firstText).toContain('Refresh 1: not listed upstream (5)');
    expect(notices()[1]?.textContent).toContain('Refresh 2: not listed upstream (2)');
    expect(notices().every((notice) => !notice.textContent.includes('local-opus'))).toBe(true);
    expect(picker.byTestId('upstream-provenance')).toEqual(marks);
    expect(marks.map((mark) => mark.textContent)).toEqual(['Not in the latest list', 'Not in the latest list', '', '', '']);
    expect(picker.checked()).toEqual(['local-opus', 'local-haiku']);
  });

  it.each([
    ['Antigravity', groupAntigravityUpstream],
    ['Devin', groupDevinUpstream],
  ] as const)('marks omitted %s rows without changing headings when retry appends a group from the same vendor', async (_kind, groupModels) => {
    const extra = { id: 'claude-opus', name: 'Claude Opus' };
    const originalHeadings = ['Claude · 1', 'Gemini · 1'];
    const load = vi.fn<PickerProps['load']>()
      .mockResolvedValueOnce({ status: 'fallback', models: models.slice(0, 2), failure: 'network', httpStatus: null })
      .mockResolvedValueOnce({ status: 'ok', models: [extra, models[1]!] });
    const picker = await render({ load, groupModels });
    const rows = picker.rows();
    const headings = picker.byTestId('upstream-group');
    expect(headings.map((node) => node.textContent)).toEqual(originalHeadings);
    await picker.retry();
    expect(picker.order()).toEqual([ids[0], ids[1], extra.id]);
    expect(picker.byTestId('upstream-group').map((node) => node.textContent)).toEqual([...originalHeadings, 'Claude · 1']);
    expect(picker.row(ids[0]!).getAttribute('data-model-source')).toBe('missing');
    expect(picker.row(ids[1]!).getAttribute('data-model-source')).toBe('upstream');
    for (const [index, row] of rows.entries()) {
      expect(picker.rows()[index]).toBe(row);
      expect(picker.byTestId('upstream-group')[index]).toBe(headings[index]);
    }
    await picker.search('claude');
    expect(picker.byTestId('upstream-group').map((node) => node.textContent)).toEqual(['Claude · 1', 'Claude · 1']);
    await picker.click(picker.row(extra.id));
    expect(await picker.save()).toEqual([extra.id]);
  });

  it('keeps the original Antigravity family heading when catalog metadata changes', async () => {
    const custom = { id: 'custom-preview', name: 'Preview', family: 'Zeta' };
    const first = [models[0]!, custom];
    const confirmed = [{ ...custom, family: 'Alpha' }, models[0]!];
    const load = vi.fn<PickerProps['load']>()
      .mockResolvedValueOnce({ status: 'fallback', models: first, failure: 'network', httpStatus: null })
      .mockResolvedValueOnce({ status: 'ok', models: confirmed });
    const picker = await render({ load, groupModels: groupAntigravityUpstream });
    const heading = picker.byTestId('upstream-group')[1];
    const row = picker.row(custom.id);
    await picker.retry();
    expect(picker.order()).toEqual([ids[0], custom.id]);
    expect(picker.byTestId('upstream-group')[1]).toBe(heading);
    expect(heading?.textContent).toBe('Zeta · 1');
    expect(picker.row(custom.id).getAttribute('data-model-source')).toBe('upstream');
    expect(picker.row(custom.id)).toBe(row);
  });

  it('appends typed IDs after opening and keeps the rows when unchecked', async () => {
    const picker = await render({
      selected: [ids[0]!],
      load: async () => ({ status: 'failed', failure: 'network', httpStatus: null }),
    });
    await picker.add('custom-instruct');
    await picker.add('custom-vision');
    const order = [ids[0], 'custom-instruct', 'custom-vision'];
    expect(picker.order()).toEqual(order);
    await picker.click(picker.box(picker.rows()[1]!));
    expect(picker.order()).toEqual(order);
    expect(picker.checked()).toEqual([ids[0], 'custom-vision']);
    await picker.click(picker.box(picker.rows()[1]!));
    expect(picker.checked()).toEqual(order);
  });
});

const configuredModel = { ...models[0]!, name: 'Saved model name', contextWindow: 200_000 };

const customProvider: ProviderRecord = {
  kind: 'custom', providerId: 'custom-api', id: 'custom-api', label: 'Custom API',
  baseUrl: 'https://models.example.test', api: 'openai-completions', authHeader: true,
  compat: {}, models: [configuredModel], createdBy: 'test-user', createdAt: 0, updatedAt: 0,
};

const pickerPaths = ['custom', 'claude', 'devin', 'antigravity'] as const;

async function openConfiguredPicker(path: typeof pickerPaths[number]) {
  const prefix = '/api/teams/test-team';
  const patch = api.patch.mockImplementation(async (...args: unknown[]) => ({
    ...customProvider,
    ...(args.at(-1) as Partial<ProviderRecord>),
    updatedAt: 1,
  }));
  const load = vi.fn<PickerProps['load']>().mockResolvedValue({ status: 'ok', models });
  let picker: Awaited<ReturnType<typeof mount>>;
  let pickerLabel: string;
  let patchArgs: string[];
  if (path === 'custom') {
    picker = await mount(h(TeamProviderEditor, {
      record: customProvider, deadModels: new Set<string>(), actions: { patch, listUpstream: load },
    }));
    pickerLabel = 'Choose from upstream';
    patchArgs = [];
  } else {
    const subscriptionPath = `${prefix}/${path}-subscriptions/subscription`;
    const queryData = [
      ...(['claude', 'devin', 'antigravity'] as const).map((vendor) => [
        `${vendor}-subscriptions`, vendor === path
          ? [{ id: 'subscription', label: 'Subscription', expiresAt: null, createdAt: 0, hasToken: true, models: [models[0]!] }]
          : [],
      ] as const),
      ['providers', { providers: [] }], ['model-sources', { sources: [] }],
      ['model-routing', { edges: [], connections: [], quota: [] }],
    ] as const;
    api.get.mockImplementation(async (url: string) => {
      const entry = queryData.find(([key]) => url === `${prefix}/${key}`);
      if (entry) return entry[1];
      throw new Error(`Unexpected GET ${url}`);
    });
    api.post.mockImplementation(async (url: string) => {
      if (url === `${prefix}/claude-subscriptions/quota`) return [];
      if (url === `${prefix}/antigravity-subscriptions/quota`) return [];
      if (url === `${subscriptionPath}/upstream-models`) return load();
      throw new Error(`Unexpected POST ${url}`);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
    for (const [key, data] of queryData) client.setQueryData([key, 'test-team'], data);
    picker = await mount(h(QueryClientProvider, { client }, h(MemoryRouter, null, h(ProvidersSection))));
    pickerLabel = 'Pick models';
    patchArgs = [subscriptionPath];
  }
  const opener = picker.nodes().find((node) => node.tagName === 'BUTTON' && node.textContent === pickerLabel)!;
  return { ...picker, opener, patch, patchArgs, load, open: () => picker.click(opener) };
}

it.each(pickerPaths)('saves an empty model array after unchecking the last %s model', async (path) => {
  const picker = await openConfiguredPicker(path);
  await picker.open();
  expect(picker.checked()).toEqual([configuredModel.id]);
  await picker.click(picker.box(picker.row(configuredModel.id)));
  expect(picker.checked()).toEqual([]);
  await picker.click(picker.byTestId('upstream-save')[0]!);
  expect(picker.patch).toHaveBeenCalledExactlyOnceWith(...picker.patchArgs, { models: [] });
});

it('saves the latest custom model name with its configured capabilities in check order', async () => {
  const picker = await openConfiguredPicker('custom');
  const renamed = { id: configuredModel.id, name: 'Sonnet Extended' };
  picker.load
    .mockResolvedValueOnce({ status: 'fallback', models: [configuredModel], failure: 'timeout', httpStatus: 504 })
    .mockResolvedValueOnce({ status: 'ok', models: [renamed, models[1]!] });
  await picker.open();
  await picker.button('Retry');
  expect(textWithoutProvenance(picker.row(renamed.id))).toContain(configuredModel.name);
  await picker.click(picker.box(picker.row(renamed.id)));
  await picker.click(picker.box(picker.row(ids[1]!)));
  await picker.click(picker.box(picker.row(renamed.id)));
  await picker.click(picker.byTestId('upstream-save')[0]!);
  expect(picker.patch).toHaveBeenCalledExactlyOnceWith({
    models: [models[1]!, { ...configuredModel, name: renamed.name }],
  });
});

it.each(['custom', 'claude'] as const)('returns focus without scrolling to the actual %s picker opener', async (path) => {
  const picker = await openConfiguredPicker(path);
  const doc = picker.opener.ownerDocument!;
  doc.activeElement = doc.body;
  await picker.open();
  const search = picker.field('Search models');
  doc.activeElement = search;
  await picker.button('Cancel');
  expect(picker.byTestId('dialog-body')).toHaveLength(0);
  expect(doc.activeElement).toBe(picker.opener);
  expect(picker.opener.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
});

it.each([
  ['claude', 'custom model'],
  ['claude', '!custom'],
  ['claude', 'x'.repeat(257)],
  ['devin', 'x'.repeat(257)],
  ['antigravity', 'x'.repeat(257)],
] as const)('excludes an invalid manual ID from the %s PATCH while valid picks stay saveable (%#)', async (vendor, invalidId) => {
  const prefix = '/api/teams/test-team';
  const subscription = { id: 'subscription', label: 'Subscription', expiresAt: null, createdAt: 0, hasToken: true, models: [] };
  const subscriptionPath = `${prefix}/${vendor}-subscriptions`;
  api.post.mockImplementation(async (path: string) => {
    if (path === `${prefix}/claude-subscriptions/quota`) return [];
    if (path === `${prefix}/antigravity-subscriptions/quota`) return [];
    if (path === `${subscriptionPath}/subscription/upstream-models`) return { status: 'ok', models: [models[0]!] };
    throw new Error(`Unexpected POST ${path}`);
  });
  const queryData = [
    ...(['claude', 'devin', 'antigravity'] as const).map((kind) => [
      `${kind}-subscriptions`, kind === vendor ? [subscription] : [],
    ] as const),
    ['providers', { providers: [] }], ['model-sources', { sources: [] }],
    ['model-routing', { edges: [], connections: [], quota: [] }],
  ] as const;
  api.get.mockImplementation(async (path: string) => {
    const entry = queryData.find(([key]) => path === `${prefix}/${key}`);
    if (entry) return entry[1];
    throw new Error(`Unexpected GET ${path}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
  for (const [key, data] of queryData) client.setQueryData([key, 'test-team'], data);
  api.patch.mockResolvedValue({});
  const picker = await mount(h(QueryClientProvider, { client }, h(MemoryRouter, null, h(ProvidersSection))));
  await picker.button('Pick models');
  await picker.add(invalidId);
  expect(picker.field('Model ID').value).toBe(invalidId);
  expect(picker.field('Model ID').getAttribute('aria-invalid')).toBe('true');
  const errorId = picker.field('Model ID').getAttribute('aria-describedby');
  expect(errorId).toBeTruthy();
  expect(picker.nodes().find((node) => node.id === errorId)?.textContent).toBe('Enter a valid model ID from the provider.');
  expect(picker.order()).toEqual([models[0]!.id]);
  expect(picker.byTestId('upstream-save')[0]!.hasAttribute('disabled')).toBe(true);
  await picker.click(picker.byTestId('upstream-save')[0]!);
  expect(api.patch).not.toHaveBeenCalled();
  await picker.click(picker.row(models[0]!.id));
  expect(picker.byTestId('upstream-save')[0]!.hasAttribute('disabled')).toBe(false);
  await picker.click(picker.byTestId('upstream-save')[0]!);
  expect(api.patch).toHaveBeenCalledExactlyOnceWith(`${subscriptionPath}/subscription`, { models: [models[0]!] });
});

it.each(['settled', 'late'] as const)('does not reuse a %s catalog from another subscription', async (timing) => {
  const shared = { ...models[0]!, contextTokens: 200_000 };
  const subscriptions = ['first', 'second'].map((id) => ({
    id, label: id, expiresAt: null, createdAt: 0, hasToken: true,
    models: [{ id: shared.id, name: shared.id }],
  }));
  const prefix = '/api/teams/test-team';
  const first = deferredCatalog();
  api.get.mockImplementation(async (path: string) => {
    if (path === `${prefix}/antigravity-subscriptions`) return subscriptions;
    if (path === `${prefix}/providers`) return { providers: [] };
    if (path === `${prefix}/model-sources`) return { sources: [] };
    if (path === `${prefix}/model-routing`) return { edges: [], connections: [], quota: [] };
    if (path === `${prefix}/devin-subscriptions` || path === `${prefix}/claude-subscriptions`) return [];
    throw new Error(`Unexpected GET ${path}`);
  });
  api.post.mockImplementation(async (path: string) => {
    if (path === `${prefix}/claude-subscriptions/quota`) return [];
    if (path === `${prefix}/antigravity-subscriptions/quota`) return [];
    if (path === `${prefix}/antigravity-subscriptions/first/upstream-models`) return first.promise;
    if (path === `${prefix}/antigravity-subscriptions/second/upstream-models`) {
      return { status: 'failed', failure: 'network', httpStatus: null };
    }
    throw new Error(`Unexpected POST ${path}`);
  });
  api.patch.mockResolvedValue({});
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  for (const [key, data] of [
    ['antigravity-subscriptions', subscriptions], ['claude-subscriptions', []], ['devin-subscriptions', []],
    ['providers', { providers: [] }], ['model-sources', { sources: [] }],
    ['model-routing', { edges: [], connections: [], quota: [] }],
  ] as const) client.setQueryData([key, 'test-team'], data);
  const picker = await mount(h(QueryClientProvider, { client }, h(MemoryRouter, null, h(ProvidersSection))));
  await picker.button('Pick models');
  const settleFirst = () => act(async () => first.resolve({ status: 'ok', models: [shared] }));
  if (timing === 'settled') await settleFirst();
  await picker.button('Cancel');
  await picker.button('second');
  await picker.button('Pick models');
  expect(picker.byTestId('upstream-error')).toHaveLength(1);
  if (timing === 'late') await settleFirst();
  await picker.click(picker.byTestId('upstream-save')[0]!);
  expect(api.patch).toHaveBeenCalledExactlyOnceWith(`${prefix}/antigravity-subscriptions/second`, {
    models: [{ id: shared.id, name: shared.id }],
  });
});
