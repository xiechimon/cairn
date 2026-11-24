import type { ModelSource, ProviderRecord, ProviderTestResult, TeamProviderTestResult } from '@cairn/shared';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { Children, type ComponentProps, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ProviderPanel } from '../src/components/providers/provider-panel.js';
import { Button } from '../src/components/ui/button.js';
import { CommitInput, Field, ModelChip, ModelTestReport, TeamProviderEditor, useModelTests } from '../src/resources/provider-editors.js';
import { DialogShell } from '../src/components/ui/dialog-shell.js';
import { ProvidersSection } from '../src/resources/providers-page.js';
import { UpstreamModelPicker } from '../src/resources/upstream-model-picker.js';

const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, changed: false }));
const requests = vi.hoisted(() => ({ test: vi.fn(), patch: vi.fn(), refetch: vi.fn(), providers: [] as ProviderRecord[], sources: [] as ModelSource[], client: null as QueryClient | null }));

vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useEffect: () => undefined,
  useState: (initial: unknown) => {
    const slots = hooks.slots;
    const index = hooks.cursor++;
    if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
    return [slots[index], (next: unknown) => {
      const value = typeof next === 'function' ? next(slots[index]) : next;
      if (!Object.is(slots[index], value)) hooks.changed = true;
      slots[index] = value;
    }];
  },
  useRef: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
    return hooks.slots[index];
  },
}));
vi.mock('@tanstack/react-query', async (original) => ({
  ...await original<typeof import('@tanstack/react-query')>(),
  useQueryClient: () => requests.client ?? ({
    getQueryData: () => ({ providers: requests.providers }),
    getQueryCache: () => ({
      find: () => ({
        state: { data: { providers: requests.providers }, fetchStatus: 'idle' },
        isActive: () => true,
        fetch: requests.refetch,
      }),
      subscribe: () => () => undefined,
    }),
  }),
  useQuery: () => ({ data: [] }),
  useMutation: () => ({}),
}));
vi.mock('react-router', () => ({ useSearchParams: () => [new URLSearchParams(), vi.fn()] }));
vi.mock('../src/api/provider.js', () => ({ useLiveData: () => ({ live: true, teamId: 't1' }) }));
vi.mock('../src/api/hooks.js', () => ({
  useModelSources: () => ({ data: { sources: requests.sources } }),
  useProviders: () => ({ data: { providers: requests.providers, canTestConnection: true } }),
  useSaveProviderOrder: () => ({}),
  useUpdateRuntime: () => ({ mutateAsync: vi.fn() }),
  useApiMutations: () => ({
    patchProvider: { mutateAsync: requests.patch },
    testProvider: { mutateAsync: requests.test },
  }),
}));
vi.mock('../src/api/model-routing.js', () => ({
  MODEL_ROUTING_KEY: 'model-routing',
  useModelRouting: () => ({ data: { connections: [] } }),
}));
vi.mock('../src/i18n/provider.js', () => ({ useI18n: () => ({ t: (key: string) => key, locale: 'zh' }) }));

const RECORD = {
  kind: 'custom', providerId: 'relay-fixture', id: 'prov-relay', label: 'Relay connection',
  baseUrl: 'https://gateway.example.invalid/v1', api: 'openai-completions', authHeader: false,
  compat: {}, models: [{ id: 'small-model', name: 'Small model' }],
  createdBy: 'test-owner', createdAt: 1, updatedAt: 1,
  configurationFingerprint: 'a'.repeat(32),
} satisfies ProviderRecord;
const OTHER_FINGERPRINT = 'b'.repeat(32);
const THIRD_FINGERPRINT = 'c'.repeat(32);
const OK: TeamProviderTestResult = {
  status: 'ok', failure: null, reason: null, detail: null, httpStatus: 200, latencyMs: 412,
  configurationFingerprint: RECORD.configurationFingerprint,
};
const FAILED: TeamProviderTestResult = {
  ...OK, status: 'failed', failure: 'not-found', httpStatus: 404, latencyMs: null,
};

it('keeps a native-auth provider with no check at not checked', () => {
  expect(pageHarness().row()).toMatchObject({ tone: 'off', statusLabel: '未检查' });
});

it('keeps the result when an OAuth token refresh refetches the same configuration', async () => {
  const page = pageHarness();
  requests.test.mockImplementationOnce(async () => {
    requests.providers = [{ ...RECORD, updatedAt: 2 }];
    return FAILED;
  });
  await page.actions().test!('small-model');
  expect(page.row()).toMatchObject({ tone: 'fail', statusLabel: '模型不存在' });
});

it('does not apply a late result to a different configuration saved in the same millisecond', async () => {
  const page = pageHarness();
  let release!: (result: TeamProviderTestResult) => void;
  requests.test.mockImplementationOnce(() => new Promise<TeamProviderTestResult>((resolve) => { release = resolve; }));
  const pending = page.actions().test!('small-model');
  const saved = { ...RECORD, configurationFingerprint: OTHER_FINGERPRINT, baseUrl: 'https://new-gateway.example.invalid/v1' };
  requests.providers = [saved];
  requests.test.mockResolvedValueOnce({ ...OK, configurationFingerprint: saved.configurationFingerprint });
  await page.actions().test!('small-model');
  release(FAILED);
  await pending;
  expect(page.row()).toMatchObject({ tone: 'ok', statusLabel: '可用' });
});

function render<T>(slots: unknown[], component: () => T): T {
  hooks.slots = slots;
  for (let attempt = 0; attempt < 25; attempt += 1) {
    hooks.cursor = 0;
    hooks.changed = false;
    const tree = component();
    if (!hooks.changed) return tree;
  }
  throw new Error('Component did not settle after render-phase updates');
}

function propsOf<P>(tree: ReactNode, type: unknown): P[] {
  return Children.toArray(tree).flatMap((node): P[] => {
    if (!isValidElement<{ children?: ReactNode }>(node)) return [];
    return [
      ...(node.type === type ? [node.props as P] : []),
      ...propsOf<P>(node.props.children, type),
    ];
  });
}

function pageHarness() {
  const slots: unknown[] = [];
  const page = () => render(slots, ProvidersSection);
  return {
    tree: page,
    actions: () => propsOf<ComponentProps<typeof TeamProviderEditor>>(page(), TeamProviderEditor)[0]!.actions,
    editor: () => propsOf<ComponentProps<typeof TeamProviderEditor>>(page(), TeamProviderEditor)[0]!,
    row: () => propsOf<ComponentProps<typeof ProviderPanel>>(page(), ProviderPanel)[0]!.items[0]!,
    rows: () => propsOf<ComponentProps<typeof ProviderPanel>>(page(), ProviderPanel)[0]!.items,
    checks: () => slots.find((slot) => typeof slot === 'object' && slot !== null && RECORD.id in slot),
  };
}

function editorHarness(page: ReturnType<typeof pageHarness>) {
  const slots: unknown[] = [];
  const editor = () => {
    const props = page.editor();
    return render(slots, () => TeamProviderEditor(props));
  };
  return {
    tree: editor,
    report: () => propsOf<ComponentProps<typeof ModelTestReport>>(editor(), ModelTestReport)[0]!,
    start: () => {
      const button = propsOf<ComponentProps<typeof Button>>(editor(), Button)
        .find((props) => Children.toArray(props.children).includes('全部测试'))!;
      button.onClick?.({} as Parameters<NonNullable<typeof button.onClick>>[0]);
    },
  };
}

beforeEach(() => {
  requests.providers = [{ ...RECORD }];
  requests.sources = [];
  requests.test.mockReset();
  requests.patch.mockReset();
  requests.refetch.mockReset().mockResolvedValue(null);
  requests.client = null;
});

it.each([
  { kind: 'Cairn 429', error: Object.assign(new Error('Request rejected'), { status: 429 }) },
  { kind: 'network error', error: new TypeError('Failed to fetch') },
  { kind: 'abort', error: new DOMException('Request aborted', 'AbortError') },
])('C1: keeps the last successful row check after $kind without a provider result', async ({ error }) => {
  const page = pageHarness();
  const test = page.actions().test!;
  requests.test.mockResolvedValueOnce(OK).mockRejectedValueOnce(error);
  await expect(test('small-model')).resolves.toEqual(OK);
  expect(page.row()).toMatchObject({ tone: 'ok', statusLabel: '可用' });
  const previous = page.checks();
  expect(previous).toEqual({ [RECORD.id]: { [RECORD.configurationFingerprint]: { 'small-model': OK } } });
  await expect(test('small-model')).rejects.toBe(error);
  expect(page.checks()).toBe(previous);
  expect(page.row()).toMatchObject({ tone: 'ok', statusLabel: '可用' });
});

it('C1: save-and-test uses the server-tested fingerprint for both the row and the detail', async () => {
  const page = pageHarness();
  requests.test.mockResolvedValueOnce(OK);
  await page.actions().test!('small-model');
  const editorSlots: unknown[] = [];
  const editor = () => {
    const props = page.editor();
    return render(editorSlots, () => TeamProviderEditor(props));
  };
  const initial = editor();
  const pick = propsOf<ComponentProps<typeof Button>>(initial, Button)
    .find((props) => Children.toArray(props.children).includes('从上游选择'))!;
  pick.onClick?.({} as Parameters<NonNullable<typeof pick.onClick>>[0]);
  const picker = propsOf<ComponentProps<typeof UpstreamModelPicker>>(editor(), UpstreamModelPicker)[0]!;
  requests.patch.mockImplementation(async ({ body }: { body: Partial<ProviderRecord> }) => {
    const saved = { ...RECORD, ...body, configurationFingerprint: OTHER_FINGERPRINT, updatedAt: 2 };
    requests.providers = [saved];
    return saved;
  });
  const tested = { ...FAILED, configurationFingerprint: THIRD_FINGERPRINT };
  requests.test.mockImplementation(async () => {
    requests.providers = [{ ...requests.providers[0]!, baseUrl: 'https://new-gateway.example.invalid/v1', configurationFingerprint: THIRD_FINGERPRINT, updatedAt: 3 }];
    return tested;
  });
  picker.onSave(['small-model', 'large-model'], new Map([['large-model', 'Large model']]), ['small-model']);
  await vi.waitFor(() => expect(requests.test).toHaveBeenCalledWith({ id: RECORD.id, model: 'large-model' }));
  const detail = propsOf<ComponentProps<typeof ModelTestReport>>(editor(), ModelTestReport)[0]!;
  expect(detail.checks['large-model']).toMatchObject({ phase: 'done', result: tested });
  expect(page.row()).toMatchObject({ tone: 'fail', statusLabel: '模型不存在' });
  expect(page.checks()).toEqual({ [RECORD.id]: {
    [RECORD.configurationFingerprint]: { 'small-model': OK },
    [THIRD_FINGERPRINT]: { 'large-model': tested },
  } });
});

it('C1: stores an upstream rate-limit result instead of treating it as a rejected request', async () => {
  const page = pageHarness();
  const result: TeamProviderTestResult = { ...FAILED, failure: 'rate-limit', httpStatus: 429 };
  requests.test.mockResolvedValue(result);
  await page.actions().test!('small-model');
  expect(page.row()).toMatchObject({ tone: 'fail', statusLabel: '限流' });
  expect(page.checks()).toEqual({ [RECORD.id]: { [RECORD.configurationFingerprint]: { 'small-model': result } } });
});

it('C1: returns a completed test while its mismatched list refetch stalls and gates the row until it arrives', async () => {
  const client = new QueryClient();
  requests.client = client;
  const queryKey = ['providers', 't1'];
  client.setQueryData(queryKey, { providers: requests.providers });
  let finishRefetch!: () => void;
  const fetchList = vi.fn(() => new Promise<{ providers: ProviderRecord[] }>((resolve) => {
    finishRefetch = () => resolve({
      providers: [{ ...RECORD, updatedAt: 0, configurationFingerprint: OTHER_FINGERPRINT }],
    });
  }));
  const observer = new QueryObserver(client, { queryKey, queryFn: fetchList, staleTime: Infinity });
  const unsubscribe = observer.subscribe(({ data }) => {
    if (data !== undefined) requests.providers = data.providers;
  });
  const refetch = vi.spyOn(client.getQueryCache().find({ queryKey })!, 'fetch');
  try {
    const page = pageHarness();
    requests.test.mockResolvedValueOnce(OK);
    await page.actions().test!('small-model');
    expect(page.row()).toMatchObject({ tone: 'ok', statusLabel: '可用' });
    expect(fetchList).not.toHaveBeenCalled();
    expect(refetch).not.toHaveBeenCalled();
    const result = { ...FAILED, configurationFingerprint: OTHER_FINGERPRINT };
    requests.test.mockResolvedValueOnce(result);
    const pending = page.actions().test!('small-model');
    await vi.waitFor(() => expect(fetchList).toHaveBeenCalledTimes(1));
    expect(requests.providers[0]!.configurationFingerprint).toBe(RECORD.configurationFingerprint);
    expect(client.getQueryData(queryKey)).toEqual({ providers: [RECORD] });
    let returned: ProviderTestResult | undefined;
    void pending.then((value) => { returned = value; });
    await vi.waitFor(() => expect(returned).toBe(result));
    expect(page.row()).toMatchObject({ tone: 'ok', statusLabel: '可用' });
    finishRefetch();
    await vi.waitFor(() => expect(page.row()).toMatchObject({ tone: 'fail', statusLabel: '模型不存在' }));
    expect(refetch).toHaveBeenCalledExactlyOnceWith(undefined, { cancelRefetch: false });
    expect(fetchList).toHaveBeenCalledTimes(1);
  } finally {
    unsubscribe();
    client.clear();
  }
});

it('C1: refetches for a late response without overwriting the current cached fingerprint', async () => {
  const page = pageHarness();
  let release!: (result: TeamProviderTestResult) => void;
  requests.test.mockImplementationOnce(() => new Promise<TeamProviderTestResult>((resolve) => { release = resolve; }));
  const pending = page.actions().test!('small-model');
  requests.providers = [{ ...RECORD, configurationFingerprint: OTHER_FINGERPRINT }];
  requests.test.mockResolvedValueOnce({ ...OK, configurationFingerprint: OTHER_FINGERPRINT });
  await page.actions().test!('small-model');
  expect(requests.refetch).not.toHaveBeenCalled();
  release(FAILED);
  await pending;
  expect(requests.refetch).toHaveBeenCalledExactlyOnceWith(undefined, { cancelRefetch: false });
  expect(requests.providers[0]!.configurationFingerprint).toBe(OTHER_FINGERPRINT);
  expect(page.row()).toMatchObject({ tone: 'ok', statusLabel: '可用' });
});

it('C1: never matches a test result to an older-server record with no fingerprint', async () => {
  const { configurationFingerprint: _, ...legacy } = RECORD;
  requests.providers = [legacy];
  const page = pageHarness();
  requests.test.mockResolvedValueOnce(OK);
  await page.actions().test!('small-model');
  expect(page.row()).toMatchObject({ tone: 'off', statusLabel: '未检查' });
  expect(requests.providers[0]).not.toHaveProperty('configurationFingerprint');
});

it.each(['ok', 'failed'] as const)('C22: shows a legacy %s result only in the detail when both fingerprints are missing', async (status) => {
  const { configurationFingerprint: _, ...record } = RECORD;
  const { configurationFingerprint: _result, ...result } = status === 'ok' ? OK : FAILED;
  requests.providers = [record];
  const page = pageHarness();
  const editor = editorHarness(page);
  let finish!: (value: ProviderTestResult) => void;
  requests.test.mockImplementationOnce(() => new Promise<ProviderTestResult>((resolve) => { finish = resolve; }));
  editor.start();
  expect(editor.report().checks['small-model']).toMatchObject({ phase: 'running' });
  finish(result);
  await vi.waitFor(() => expect(editor.report().checks['small-model']).toMatchObject({ phase: 'done', result }));
  expect(editor.report().report).toMatchObject({ open: true, ids: ['small-model'] });
  expect(page.row()).toMatchObject({ tone: 'off', statusLabel: '未检查' });
  expect(requests.refetch).not.toHaveBeenCalled();
});

it('C1: hides an older-server result without a fingerprint without replacing a row check', async () => {
  const page = pageHarness();
  const baseline = page.row();
  const editorSlots: unknown[] = [];
  const editor = () => {
    const props = page.editor();
    return render(editorSlots, () => TeamProviderEditor(props));
  };
  const testButton = () => propsOf<ComponentProps<typeof Button>>(editor(), Button)
    .find((props) => Children.toArray(props.children).includes('全部测试'))!;
  const { configurationFingerprint: _, ...legacy } = FAILED;
  requests.test.mockResolvedValueOnce(legacy);
  const start = () => {
    const button = testButton();
    button.onClick?.({ currentTarget: null } as unknown as Parameters<NonNullable<typeof button.onClick>>[0]);
  };
  start();
  await vi.waitFor(() => {
    const detail = propsOf<ComponentProps<typeof ModelTestReport>>(editor(), ModelTestReport)[0]!;
    expect(requests.test).toHaveBeenCalledTimes(1);
    expect(detail.checks).toEqual({});
    expect(detail.report).toBeNull();
  });
  expect(page.checks()).toBeUndefined();
  expect(page.row()).toEqual(baseline);
  requests.test.mockResolvedValueOnce(OK);
  await page.actions().test!('small-model');
  const previous = page.checks();
  requests.test.mockResolvedValueOnce(legacy);
  await expect(page.actions().test!('small-model')).resolves.toBe(legacy);
  expect(page.checks()).toBe(previous);
  expect(page.row()).toMatchObject({ tone: 'ok', statusLabel: '可用' });
});

it('C1 C23: keeps the detail result when a held mismatch refetch confirms the probed endpoint B', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  requests.client = client;
  const queryKey = ['providers', 't1'];
  client.setQueryData(queryKey, { providers: requests.providers });
  const confirmed = { ...RECORD, baseUrl: 'https://new-gateway.example.invalid/v1', configurationFingerprint: OTHER_FINGERPRINT };
  let finishRefetch!: () => void;
  const fetchList = vi.fn(() => new Promise<{ providers: ProviderRecord[] }>((resolve) => {
    finishRefetch = () => resolve({ providers: [confirmed] });
  }));
  const observer = new QueryObserver(client, { queryKey, queryFn: fetchList, staleTime: Infinity });
  const unsubscribe = observer.subscribe(({ data }) => {
    if (data !== undefined) requests.providers = data.providers;
  });
  try {
    const page = pageHarness();
    const editor = editorHarness(page);
    const result = { ...FAILED, configurationFingerprint: OTHER_FINGERPRINT };
    requests.test.mockResolvedValueOnce(result);
    editor.start();
    await vi.waitFor(() => expect(fetchList).toHaveBeenCalledTimes(1));
    expect(editor.report().checks).toEqual({});
    expect(editor.report().report).toBeNull();
    expect(requests.providers[0]!.configurationFingerprint).toBe(RECORD.configurationFingerprint);
    finishRefetch();
    await vi.waitFor(() => expect(page.row()).toMatchObject({ tone: 'fail', statusLabel: '模型不存在' }));
    expect(editor.report().checks['small-model']).toMatchObject({ phase: 'done', result });
    expect(editor.report().report).toMatchObject({ open: true, ids: ['small-model'] });
  } finally {
    unsubscribe();
    client.clear();
  }
});

it('C1: retains the returned B report while discarding another model result from A', async () => {
  requests.providers = [{ ...RECORD, models: [...RECORD.models, { id: 'large-model', name: 'Large model' }] }];
  const page = pageHarness();
  const editor = editorHarness(page);
  requests.test.mockResolvedValue(OK);
  editor.start();
  await vi.waitFor(() => expect(editor.report().checks['large-model']).toMatchObject({ phase: 'done', result: OK }));
  const chip = propsOf<ComponentProps<typeof ModelChip>>(editor.tree(), ModelChip).find((props) => props.id === 'large-model')!;
  const result = { ...FAILED, configurationFingerprint: OTHER_FINGERPRINT };
  requests.test.mockResolvedValueOnce(result);
  chip.onTest!({} as Element);
  await vi.waitFor(() => expect(requests.test).toHaveBeenCalledTimes(3));
  await vi.waitFor(() => expect(editor.report().checks['large-model']).toBeUndefined());
  expect(editor.report().report).toBeNull();
  requests.providers = [{ ...requests.providers[0]!, updatedAt: 2, baseUrl: 'https://new-gateway.example.invalid/v1', configurationFingerprint: OTHER_FINGERPRINT }];
  expect(editor.report().checks).toEqual({ 'large-model': expect.objectContaining({ phase: 'done', result }) });
  expect(editor.report().report).toMatchObject({ open: true, ids: ['large-model'] });
});

it('C1 C23: keeps a completed C check when the list first delivers intermediate configuration B', async () => {
  const page = pageHarness();
  const editor = editorHarness(page);
  const result = { ...FAILED, configurationFingerprint: THIRD_FINGERPRINT };
  requests.test.mockResolvedValueOnce(result);
  editor.start();
  expect(editor.report().checks['small-model']).toMatchObject({ phase: 'running' });
  await vi.waitFor(() => expect(editor.report().checks['small-model']).toBeUndefined());

  requests.providers = [{ ...RECORD, configurationFingerprint: OTHER_FINGERPRINT, updatedAt: 2 }];
  expect(editor.report().report).toBeNull();
  requests.providers = [{ ...RECORD, configurationFingerprint: THIRD_FINGERPRINT, updatedAt: 3 }];
  expect(editor.report().checks['small-model']).toMatchObject({ phase: 'done', result });
  expect(editor.report().report).toMatchObject({ ids: ['small-model'], open: true });
  expect(page.row()).toMatchObject({ tone: 'fail' });
});

it('C1 C22: hides the pending A check and its late result after the cached fingerprint changes to B', async () => {
  const editor = editorHarness(pageHarness());
  let release!: (result: TeamProviderTestResult) => void;
  requests.test.mockImplementationOnce(() => new Promise<TeamProviderTestResult>((resolve) => { release = resolve; }));
  editor.start();
  expect(editor.report().checks['small-model']).toMatchObject({ phase: 'running' });
  requests.providers = [{ ...RECORD, configurationFingerprint: OTHER_FINGERPRINT }];
  expect(editor.report().checks).toEqual({});
  expect(editor.report().report).toBeNull();
  expect(propsOf<ComponentProps<typeof ModelChip>>(editor.tree(), ModelChip)[0]!.check).toBeUndefined();
  requests.providers = [RECORD];
  expect(editor.report().checks['small-model']).toMatchObject({ phase: 'running' });
  requests.providers = [{ ...RECORD, configurationFingerprint: OTHER_FINGERPRINT }];
  release(OK);
  await vi.waitFor(() => expect(requests.refetch).toHaveBeenCalledTimes(1));
  expect(editor.report().checks).toEqual({});
  expect(editor.report().report).toBeNull();
});

it.each(['key', 'endpoint', 'credential'])(
  'C1: clears the detail when a saved %s changes the fingerprint without relying on endpoint text',
  async (change) => {
    const editor = editorHarness(pageHarness());
    requests.test.mockResolvedValueOnce(OK);
    editor.start();
    await vi.waitFor(() => expect(editor.report().checks['small-model']).toMatchObject({ phase: 'done', result: OK }));
    requests.providers = [{
      ...RECORD,
      ...(change === 'endpoint' ? { baseUrl: 'https://new-gateway.example.invalid/v1' } : {}),
      configurationFingerprint: OTHER_FINGERPRINT,
    }];
    expect(editor.report().checks).toEqual({});
    expect(editor.report().report).toBeNull();
  },
);

it.each(['key', 'endpoint'])(
  'C1: submitting a %s alone does not clear the result before the authoritative fingerprint changes',
  async (change) => {
    const editor = editorHarness(pageHarness());
    requests.test.mockResolvedValueOnce(OK);
    editor.start();
    await vi.waitFor(() => expect(editor.report().checks['small-model']).toMatchObject({ phase: 'done', result: OK }));
    const shown = editor.report();
    requests.patch.mockRejectedValueOnce(new Error('Save failed'));
    if (change === 'endpoint') {
      const input = propsOf<ComponentProps<typeof CommitInput>>(editor.tree(), CommitInput).find((props) => props.label === '地址')!;
      input.onCommit!('https://new-gateway.example.invalid/v1');
    } else {
      const field = propsOf<ComponentProps<typeof Field>>(editor.tree(), Field).find((props) => props.label === 'API key')!;
      if (!isValidElement<{ onReplace: (key: string) => void }>(field.children)) throw new Error('Key field did not render');
      field.children.props.onReplace('fixture-replacement-key');
    }
    await vi.waitFor(() => expect(requests.patch).toHaveBeenCalledTimes(1));
    expect(editor.report().checks).toBe(shown.checks);
    expect(editor.report().report).toBe(shown.report);
  },
);

it('C1: preserves the detail when endpoint metadata changes but the fingerprint stays the same', async () => {
  const editor = editorHarness(pageHarness());
  requests.test.mockResolvedValueOnce(OK);
  editor.start();
  await vi.waitFor(() => expect(editor.report().checks['small-model']).toMatchObject({ phase: 'done', result: OK }));
  const shown = editor.report();
  requests.providers = [{ ...RECORD, baseUrl: 'https://canonical-gateway.example.invalid/v1', updatedAt: 2 }];
  expect(editor.report().checks).toBe(shown.checks);
  expect(editor.report().report).toBe(shown.report);
});

it('C1 C22: hides the old spinner but accepts a B result when the list learns B before it returns', async () => {
  const page = pageHarness();
  const editor = editorHarness(page);
  let finish!: (result: TeamProviderTestResult) => void;
  requests.test.mockImplementationOnce(() => new Promise<TeamProviderTestResult>((resolve) => { finish = resolve; }));
  editor.start();
  requests.providers = [{ ...RECORD, updatedAt: 2, configurationFingerprint: OTHER_FINGERPRINT }];
  expect(editor.report().checks).toEqual({});
  expect(editor.report().report).toBeNull();
  const result = { ...FAILED, configurationFingerprint: OTHER_FINGERPRINT };
  finish(result);
  await vi.waitFor(() => expect(editor.report().checks['small-model']).toMatchObject({ phase: 'done', result }));
  expect(editor.report().report).toMatchObject({ open: true });
  expect(page.row()).toMatchObject({ tone: 'fail' });
});

it.each([false, true])('C24: the next edit keeps another client model across queue reconciliation (queued=%s)', async (duringPending) => {
  const middle = { id: 'middle-model', name: 'Middle model' };
  const added = { id: 'external-model', name: 'External model' };
  requests.providers = [{ ...RECORD, models: [...RECORD.models, middle] }];
  const editor = editorHarness(pageHarness());
  let finish!: (saved: ProviderRecord) => void;
  requests.patch.mockImplementationOnce(() => new Promise<ProviderRecord>((resolve) => { finish = resolve; }));
  requests.patch.mockImplementation(async ({ body }: { body: Partial<ProviderRecord> }) => ({ ...RECORD, ...body, updatedAt: 4 }));
  const remove = (id: string) => propsOf<ComponentProps<typeof ModelChip>>(editor.tree(), ModelChip).find((chip) => chip.id === id)!.onRemove!();
  remove(middle.id);
  await vi.waitFor(() => expect(requests.patch).toHaveBeenCalledTimes(1));
  if (duringPending) {
    requests.providers = [{ ...RECORD, updatedAt: 3, models: [...RECORD.models, added] }];
    editor.tree();
    remove('small-model');
  }
  finish({ ...RECORD, updatedAt: 2 });
  if (!duringPending) {
    await vi.waitFor(() => expect(propsOf<ComponentProps<typeof ModelChip>>(editor.tree(), ModelChip).every((chip) => !chip.busy)).toBe(true));
    requests.providers = [{ ...RECORD, updatedAt: 3, models: [...RECORD.models, added] }];
    remove('small-model');
  }
  await vi.waitFor(() => expect(requests.patch).toHaveBeenCalledTimes(2));
  expect(requests.patch.mock.calls[1]![0].body.models).toEqual([added]);
});

it('C1 C22 C24: a model save retains the matching check that completed while the PATCH was held', async () => {
  const removed = { id: 'retired-model', name: 'Retired model' };
  requests.providers = [{ ...RECORD, models: [...RECORD.models, removed] }];
  const page = pageHarness();
  const editor = editorHarness(page);
  const chips = () => propsOf<ComponentProps<typeof ModelChip>>(editor.tree(), ModelChip);
  requests.test.mockResolvedValueOnce(OK);
  chips()[0]!.onTest!({} as Element);
  await vi.waitFor(() => expect(editor.report().checks['small-model']).toMatchObject({ phase: 'done', result: OK }));

  let finish!: (saved: ProviderRecord) => void;
  requests.patch.mockImplementationOnce(() => new Promise<ProviderRecord>((resolve) => { finish = resolve; }));
  chips().find((chip) => chip.id === removed.id)!.onRemove!();
  await vi.waitFor(() => expect(requests.patch).toHaveBeenCalledTimes(1));
  const result = { ...FAILED, configurationFingerprint: OTHER_FINGERPRINT };
  requests.test.mockResolvedValueOnce(result);
  chips()[0]!.onTest!({} as Element);
  expect(editor.report().checks['small-model']).toMatchObject({ phase: 'running' });
  await vi.waitFor(() => expect(editor.report().checks['small-model']).toBeUndefined());

  finish({ ...RECORD, configurationFingerprint: OTHER_FINGERPRINT, updatedAt: 2 });
  await vi.waitFor(() => expect(chips()[0]!.busy).toBe(false));
  expect(editor.report().checks['small-model']).toMatchObject({ phase: 'done', result });
  expect(editor.report().report).toMatchObject({ ids: ['small-model'], open: true });
});

it('C24: serializes model edits from the latest saved record before the list rerenders', async () => {
  const middle = { id: 'middle-model', name: 'Middle model' };
  const large = { id: 'large-model', name: 'Large model' };
  requests.providers = [{ ...RECORD, models: [...RECORD.models, middle, large] }];
  const editor = editorHarness(pageHarness());
  const chips = propsOf<ComponentProps<typeof ModelChip>>(editor.tree(), ModelChip);
  let finish!: (saved: ProviderRecord) => void;
  requests.patch.mockImplementationOnce(() => new Promise<ProviderRecord>((resolve) => { finish = resolve; }));
  requests.patch.mockImplementation(async ({ body }: { body: Partial<ProviderRecord> }) => ({ ...RECORD, ...body, updatedAt: 3 }));
  chips.find((chip) => chip.id === middle.id)!.onRemove!();
  await vi.waitFor(() => expect(requests.patch).toHaveBeenCalledTimes(1));
  expect(propsOf<ComponentProps<typeof ModelChip>>(editor.tree(), ModelChip).every((chip) => chip.busy)).toBe(true);
  chips.find((chip) => chip.id === large.id)!.onRemove!();
  expect(requests.patch).toHaveBeenCalledTimes(1);
  const canonical = { ...RECORD.models[0]!, name: 'Canonical small model' };
  finish({ ...RECORD, models: [canonical, large], updatedAt: 2 });
  await vi.waitFor(() => expect(requests.patch).toHaveBeenCalledTimes(2));
  expect(requests.patch.mock.calls.map(([input]) => input.body.models.map((model: { id: string }) => model.id))).toEqual([
    ['small-model', 'large-model'],
    ['small-model'],
  ]);
  expect(requests.patch.mock.calls[1]![0].body.models).toEqual([canonical]);
  await vi.waitFor(() => expect(propsOf<ComponentProps<typeof ModelChip>>(editor.tree(), ModelChip).map((chip) => chip.id)).toEqual(['small-model']));
});

it.each([false, true].flatMap((legacy) => [false, true].map((refresh) => ({ legacy, refresh }))))('C24: equal-time model saves remain the next edit base (legacy=$legacy, refresh=$refresh)', async ({ legacy, refresh }) => {
  const middle = { id: 'middle-model', name: 'Middle model' };
  const large = { id: 'large-model', name: 'Large model' };
  const { configurationFingerprint: _, ...withoutFingerprint } = RECORD;
  const original = { ...(legacy ? withoutFingerprint : RECORD), models: [...RECORD.models, middle, large] };
  requests.providers = [original];
  const editor = editorHarness(pageHarness());
  requests.patch.mockImplementation(async ({ body }: { body: Partial<ProviderRecord> }) => ({ ...original, ...body }));
  const remove = (id: string) => propsOf<ComponentProps<typeof ModelChip>>(editor.tree(), ModelChip).find((chip) => chip.id === id)!.onRemove!();
  remove(middle.id);
  await vi.waitFor(() => expect(requests.patch).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(propsOf<ComponentProps<typeof ModelChip>>(editor.tree(), ModelChip).every((chip) => !chip.busy)).toBe(true));
  if (refresh) requests.providers = [{ ...original, models: original.models.map((model) => ({ ...model })) }];
  remove(large.id);
  await vi.waitFor(() => expect(requests.patch).toHaveBeenCalledTimes(2));
  expect(requests.patch.mock.calls.map(([input]) => input.body.models.map((model: { id: string }) => model.id))).toEqual([
    ['small-model', 'large-model'],
    ['small-model'],
  ]);
  expect(propsOf<ComponentProps<typeof ModelChip>>(editor.tree(), ModelChip).map((chip) => chip.id)).toEqual(['small-model']);
});

it('C24: a stale list refresh cannot become the base of the next model edit', async () => {
  const middle = { id: 'middle-model', name: 'Middle model' };
  const large = { id: 'large-model', name: 'Large model' };
  const original = { ...RECORD, models: [...RECORD.models, middle, large] };
  requests.providers = [original];
  const editor = editorHarness(pageHarness());
  requests.patch.mockImplementation(async ({ body }: { body: Partial<ProviderRecord> }) => ({ ...original, ...body, updatedAt: 2 }));
  const remove = (id: string) => propsOf<ComponentProps<typeof ModelChip>>(editor.tree(), ModelChip).find((chip) => chip.id === id)!.onRemove!();
  remove(middle.id);
  await vi.waitFor(() => expect(propsOf<ComponentProps<typeof ModelChip>>(editor.tree(), ModelChip).map((chip) => chip.id)).toEqual(['small-model', 'large-model']));
  requests.providers = [{ ...original, models: original.models.map((model) => ({ ...model })) }];
  remove(large.id);
  await vi.waitFor(() => expect(requests.patch).toHaveBeenCalledTimes(2));
  expect(requests.patch.mock.calls[1]![0].body.models).toEqual(RECORD.models);
});

it('C24: a queued model edit bases on the newest cached record before the editor rerenders', async () => {
  const middle = { id: 'middle-model', name: 'Middle model' };
  const external = { id: 'external-model', name: 'External model' };
  requests.providers = [{ ...RECORD, models: [...RECORD.models, middle] }];
  const editor = editorHarness(pageHarness());
  let finish!: (saved: ProviderRecord) => void;
  requests.patch.mockImplementationOnce(() => new Promise<ProviderRecord>((resolve) => { finish = resolve; }));
  requests.patch.mockImplementation(async ({ body }: { body: Partial<ProviderRecord> }) => ({ ...RECORD, ...body, updatedAt: 4 }));
  const chips = () => propsOf<ComponentProps<typeof ModelChip>>(editor.tree(), ModelChip);
  chips().find((chip) => chip.id === middle.id)!.onRemove!();
  await vi.waitFor(() => expect(requests.patch).toHaveBeenCalledTimes(1));
  const removeSmall = chips().find((chip) => chip.id === 'small-model')!.onRemove!;
  requests.providers = [{
    ...RECORD,
    updatedAt: 3,
    models: [...RECORD.models, middle, external],
  }];
  removeSmall();
  finish({ ...RECORD, models: RECORD.models, updatedAt: 2 });
  await vi.waitFor(() => expect(requests.patch).toHaveBeenCalledTimes(2));
  expect(requests.patch.mock.calls[1]![0].body.models).toEqual([middle, external]);
});

it('C24: a failed queued model save rolls back and lets the next edit use the last success', async () => {
  const middle = { id: 'middle-model', name: 'Middle model' };
  const large = { id: 'large-model', name: 'Large model' };
  requests.providers = [{ ...RECORD, models: [...RECORD.models, middle, large] }];
  const editor = editorHarness(pageHarness());
  const chips = propsOf<ComponentProps<typeof ModelChip>>(editor.tree(), ModelChip);
  let fail!: (error: Error) => void;
  requests.patch.mockImplementationOnce(() => new Promise<ProviderRecord>((_resolve, reject) => { fail = reject; }));
  requests.patch.mockImplementation(async ({ body }: { body: Partial<ProviderRecord> }) => ({ ...RECORD, ...body, updatedAt: 2 }));
  chips.find((chip) => chip.id === middle.id)!.onRemove!();
  await vi.waitFor(() => expect(requests.patch).toHaveBeenCalledTimes(1));
  chips.find((chip) => chip.id === large.id)!.onRemove!();
  expect(requests.patch).toHaveBeenCalledTimes(1);
  fail(new Error('Fixture save failed'));
  await vi.waitFor(() => expect(requests.patch).toHaveBeenCalledTimes(2));
  expect(requests.patch.mock.calls[1]![0].body.models).toEqual([...RECORD.models, middle]);
  await vi.waitFor(() => expect(propsOf<ComponentProps<typeof ModelChip>>(editor.tree(), ModelChip).map((chip) => chip.id)).toEqual(['small-model', 'middle-model']));
});

it.each([RECORD.configurationFingerprint, OTHER_FINGERPRINT].flatMap((configurationFingerprint) => [false, true].map((empty) => ({ configurationFingerprint, empty }))))('C1 C23: a held save-and-test keeps the report across a model refresh with saved fingerprint $configurationFingerprint and empty=$empty', async ({ configurationFingerprint, empty }) => {
  requests.providers = [{ ...RECORD, models: empty ? [] : RECORD.models }];
  const page = pageHarness();
  const editor = editorHarness(page);
  const pick = propsOf<ComponentProps<typeof Button>>(editor.tree(), Button).find((props) => Children.toArray(props.children).includes('从上游选择'))!;
  pick.onClick?.({} as Parameters<NonNullable<typeof pick.onClick>>[0]);
  const picker = propsOf<ComponentProps<typeof UpstreamModelPicker>>(editor.tree(), UpstreamModelPicker)[0]!;
  requests.patch.mockImplementation(async ({ body }: { body: Partial<ProviderRecord> }) => {
    requests.providers = [{ ...RECORD, ...body, configurationFingerprint }];
    return requests.providers[0];
  });
  let finish!: (result: TeamProviderTestResult) => void;
  requests.test.mockImplementationOnce(() => new Promise<TeamProviderTestResult>((resolve) => { finish = resolve; }));
  picker.onSave(
    [...(empty ? [] : ['small-model']), 'large-model'],
    new Map(),
    empty ? [] : ['small-model'],
  );
  await vi.waitFor(() => expect(editor.report().checks['large-model']).toMatchObject({ phase: 'running' }));
  requests.providers = [{ ...requests.providers[0]!, models: [...requests.providers[0]!.models], updatedAt: 2 }];
  expect(editor.report().report).toMatchObject({ ids: ['large-model'], open: true });
  const result = { ...FAILED, configurationFingerprint };
  finish(result);
  await vi.waitFor(() => expect(editor.report().checks['large-model']).toMatchObject({ phase: 'done', result }));
  expect(editor.report().report).toMatchObject({ ids: ['large-model'], open: true });
  expect(page.row()).toMatchObject({ tone: 'fail', statusLabel: '模型不存在' });
});

it.each(['ok', 'failed', 'rejected'].flatMap((outcome) => [false, true].map((settled) => ({ outcome, settled }))))(
  'C1 C22: a late A $outcome cannot replace the B check when settled=$settled',
  async ({ outcome, settled }) => {
    const page = pageHarness();
    const editor = editorHarness(page);
    let finishA!: (result: TeamProviderTestResult) => void;
    let rejectA!: (error: Error) => void;
    let finishB!: (result: TeamProviderTestResult) => void;
    requests.test.mockImplementationOnce(() => new Promise<TeamProviderTestResult>((resolve, reject) => {
      finishA = resolve;
      rejectA = reject;
    }));
    editor.start();
    requests.providers = [{ ...RECORD, configurationFingerprint: OTHER_FINGERPRINT }];
    requests.test.mockImplementationOnce(() => new Promise<TeamProviderTestResult>((resolve) => { finishB = resolve; }));
    editor.start();
    const resultB = { ...OK, configurationFingerprint: OTHER_FINGERPRINT };
    if (settled) {
      finishB(resultB);
      await vi.waitFor(() => expect(editor.report().checks['small-model']).toMatchObject({ phase: 'done', result: resultB }));
    }
    const shown = editor.report();
    if (outcome === 'rejected') rejectA(new Error('Request rejected'));
    else finishA(outcome === 'ok' ? OK : FAILED);
    await vi.waitFor(() => expect(requests.test.mock.settledResults[0]?.type).toBe(outcome === 'rejected' ? 'rejected' : 'fulfilled'));
    expect(editor.report().checks['small-model']).toBe(shown.checks['small-model']);
    expect(editor.report().report).toBe(shown.report);
    if (!settled) {
      finishB(resultB);
      await vi.waitFor(() => expect(editor.report().checks['small-model']).toMatchObject({ phase: 'done', result: resultB }));
    }
    expect(page.row()).toMatchObject({ tone: 'ok', statusLabel: '可用' });
  },
);

it('C1: a queued A rejection cannot erase the result of a B check started first', async () => {
  const queued = { id: 'queued-model', name: 'Queued model' };
  requests.providers = [{ ...RECORD, models: [
    ...RECORD.models,
    { id: 'middle-model', name: 'Middle model' },
    { id: 'large-model', name: 'Large model' },
    queued,
  ] }];
  const page = pageHarness();
  const editor = editorHarness(page);
  let release!: (result: TeamProviderTestResult) => void;
  const held = new Promise<TeamProviderTestResult>((resolve) => { release = resolve; });
  requests.test.mockImplementationOnce(() => held);
  requests.test.mockImplementationOnce(() => held);
  requests.test.mockImplementationOnce(() => held);
  editor.start();
  expect(requests.test).toHaveBeenCalledTimes(3);
  requests.providers = [{ ...requests.providers[0]!, configurationFingerprint: OTHER_FINGERPRINT }];
  const result = { ...OK, configurationFingerprint: OTHER_FINGERPRINT };
  requests.test.mockResolvedValueOnce(result).mockRejectedValueOnce(new Error('Request rejected'));
  const chip = propsOf<ComponentProps<typeof ModelChip>>(editor.tree(), ModelChip).find((model) => model.id === queued.id)!;
  chip.onTest!({} as Element);
  await vi.waitFor(() => expect(editor.report().checks[queued.id]).toMatchObject({ phase: 'done', result }));
  release(OK);
  await vi.waitFor(() => expect(requests.test).toHaveBeenCalledTimes(5));
  await vi.waitFor(() => expect(requests.test.mock.settledResults[4]?.type).toBe('rejected'));
  expect(editor.report().checks[queued.id]).toMatchObject({ phase: 'done', result });
  expect(editor.report().report).toMatchObject({ ids: [queued.id], open: true });
});

it.each(['stale', 'intermediate', 'failed', 'superseded', 'target added mid-fetch'] as const)(
  'C1 C23: coalesces checks and follows up without another click for a %s list',
  async (scenario) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    requests.client = client;
    const queryKey = ['providers', 't1'];
    client.setQueryData(queryKey, { providers: requests.providers });
    const lists: { resolve: (record: ProviderRecord) => void; reject: (error: Error) => void }[] = [];
    const fetchList = vi.fn(() => new Promise<{ providers: ProviderRecord[] }>((resolve, reject) => {
      lists.push({ resolve: (record) => resolve({ providers: [record] }), reject });
    }));
    const observer = new QueryObserver(client, { queryKey, queryFn: fetchList, staleTime: Infinity });
    const unsubscribe = observer.subscribe(({ data }) => {
      if (data !== undefined) requests.providers = data.providers;
    });
    try {
      const page = pageHarness();
      const inFlight = scenario === 'target added mid-fetch' ? undefined : observer.refetch();
      if (inFlight !== undefined) {
        requests.test.mockResolvedValueOnce({ ...OK, configurationFingerprint: THIRD_FINGERPRINT });
        await page.actions().test!('small-model');
      }
      requests.test.mockResolvedValueOnce({ ...FAILED, configurationFingerprint: OTHER_FINGERPRINT });
      await page.actions().test!('small-model');
      requests.test.mockResolvedValueOnce({ ...OK, configurationFingerprint: THIRD_FINGERPRINT });
      await page.actions().test!('small-model');
      expect(fetchList).toHaveBeenCalledTimes(1);
      if (scenario === 'failed') lists[0]!.reject(new Error('List request failed'));
      else lists[0]!.resolve(scenario === 'stale' ? RECORD : {
        ...RECORD, configurationFingerprint: OTHER_FINGERPRINT, updatedAt: 2,
      });
      await inFlight;
      await vi.waitFor(() => expect(fetchList).toHaveBeenCalledTimes(2));
      const latest = scenario === 'superseded' ? 'd'.repeat(32) : THIRD_FINGERPRINT;
      lists[1]!.resolve({ ...RECORD, configurationFingerprint: latest, updatedAt: 3 });
      await vi.waitFor(() => expect(requests.providers[0]?.configurationFingerprint).toBe(latest));
      expect(page.row()).toMatchObject(scenario === 'superseded'
        ? { tone: 'off', statusLabel: '未检查' }
        : { tone: 'ok', statusLabel: '可用' });
      expect(fetchList).toHaveBeenCalledTimes(2);
    } finally {
      unsubscribe();
      client.clear();
    }
  },
);

it('C1 C23: a list between two checks of the same configuration cannot swallow the second refresh', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  requests.client = client;
  const queryKey = ['providers', 't1'];
  client.setQueryData(queryKey, { providers: requests.providers });
  const lists: Array<(record: ProviderRecord) => void> = [];
  const fetchList = vi.fn(() => new Promise<{ providers: ProviderRecord[] }>((resolve) => {
    lists.push((record) => resolve({ providers: [record] }));
  }));
  const observer = new QueryObserver(client, { queryKey, queryFn: fetchList, staleTime: Infinity });
  const unsubscribe = observer.subscribe(({ data }) => {
    if (data !== undefined) requests.providers = data.providers;
  });
  try {
    const page = pageHarness();
    requests.test.mockResolvedValueOnce({ ...OK, configurationFingerprint: OTHER_FINGERPRINT });
    await page.actions().test!('small-model');
    expect(fetchList).toHaveBeenCalledTimes(1);
    requests.test.mockResolvedValueOnce({ ...FAILED, configurationFingerprint: OTHER_FINGERPRINT });
    await page.actions().test!('small-model');
    expect(fetchList).toHaveBeenCalledTimes(1);
    lists[0]!({ ...RECORD, configurationFingerprint: THIRD_FINGERPRINT, updatedAt: 2 });
    await vi.waitFor(() => expect(fetchList).toHaveBeenCalledTimes(2));
    expect(page.row()).toMatchObject({ tone: 'off', statusLabel: '未检查' });
    lists[1]!({ ...RECORD, configurationFingerprint: OTHER_FINGERPRINT, updatedAt: 3 });
    await vi.waitFor(() => expect(page.row()).toMatchObject({ tone: 'fail', statusLabel: '模型不存在' }));
    expect(fetchList).toHaveBeenCalledTimes(2);
  } finally {
    unsubscribe();
    client.clear();
  }
});

it.each([false, true])('C22: keeps subscription checks without a configuration fingerprint usable (rejected=%s)', async (rejected) => {
  const slots: unknown[] = [];
  let finish!: (result: ProviderTestResult) => void;
  let fail!: (error: Error) => void;
  const test = vi.fn(() => new Promise<ProviderTestResult>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  }));
  const probe = () => render(slots, () => useModelTests(test, 2));
  const pending = probe().run(['subscription-model'], null);
  expect(probe().checks['subscription-model']).toMatchObject({ phase: 'running' });
  const { configurationFingerprint: _, ...result } = OK;
  if (rejected) fail(new Error('Request rejected'));
  else finish(result);
  await pending;
  expect(probe().checks['subscription-model']).toMatchObject(
    rejected ? { phase: 'unavailable' } : { phase: 'done', result },
  );
  expect(probe().report).toMatchObject({ ids: ['subscription-model'], open: true });
});

it.each(['endpoint', 'key'])(
  'C22: a confirmed %s change clears legacy detail checks the missing fingerprint cannot retire',
  async (change) => {
    const { configurationFingerprint: _record, ...legacy } = RECORD;
    requests.providers = [legacy];
    const page = pageHarness();
    const editor = editorHarness(page);
    const { configurationFingerprint: _result, ...result } = OK;
    requests.test.mockResolvedValueOnce(result);
    editor.start();
    await vi.waitFor(() =>
      expect(editor.report().checks['small-model']).toMatchObject({ phase: 'done', result }),
    );
    requests.patch.mockResolvedValueOnce({
      ...legacy,
      baseUrl: 'https://new-gateway.example.invalid/v1',
      updatedAt: 2,
    });
    if (change === 'endpoint') {
      const input = propsOf<ComponentProps<typeof CommitInput>>(editor.tree(), CommitInput).find(
        (props) => props.label === '地址',
      )!;
      input.onCommit!('https://new-gateway.example.invalid/v1');
    } else {
      const field = propsOf<ComponentProps<typeof Field>>(editor.tree(), Field).find(
        (props) => props.label === 'API key',
      )!;
      if (!isValidElement<{ onReplace: (key: string) => void }>(field.children))
        throw new Error('Key field did not render');
      field.children.props.onReplace('fixture-replacement-key');
    }
    await vi.waitFor(() => expect(requests.patch).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => {
      expect(editor.report().checks).toEqual({});
      expect(editor.report().report).toBeNull();
    });
  },
);

it('C22: a legacy check finishing after a confirmed connection change is dropped', async () => {
  const { configurationFingerprint: _record, ...legacy } = RECORD;
  requests.providers = [legacy];
  const page = pageHarness();
  const editor = editorHarness(page);
  let finish!: (value: ProviderTestResult) => void;
  requests.test.mockImplementationOnce(
    () => new Promise<ProviderTestResult>((resolve) => {
      finish = resolve;
    }),
  );
  editor.start();
  expect(editor.report().checks['small-model']).toMatchObject({ phase: 'running' });
  requests.patch.mockResolvedValueOnce({ ...legacy, updatedAt: 2 });
  const field = propsOf<ComponentProps<typeof Field>>(editor.tree(), Field).find(
    (props) => props.label === 'API key',
  )!;
  if (!isValidElement<{ onReplace: (key: string) => void }>(field.children))
    throw new Error('Key field did not render');
  field.children.props.onReplace('fixture-replacement-key');
  await vi.waitFor(() => expect(requests.patch).toHaveBeenCalledTimes(1));
  const { configurationFingerprint: _result, ...result } = OK;
  finish(result);
  await vi.waitFor(() => expect(requests.test.mock.settledResults[0]?.type).toBe('fulfilled'));
  expect(editor.report().checks).toEqual({});
  expect(editor.report().report).toBeNull();
});

it.each([false, true])(
  'C24: the upstream picker applies only its own edits to the freshest model list (removing=%s)',
  async (removing) => {
    const added = { id: 'external-model', name: 'External model' };
    const editor = editorHarness(pageHarness());
    const pick = propsOf<ComponentProps<typeof Button>>(editor.tree(), Button).find((props) =>
      Children.toArray(props.children).includes('从上游选择'),
    )!;
    pick.onClick?.({} as Parameters<NonNullable<typeof pick.onClick>>[0]);
    const picker = () =>
      propsOf<ComponentProps<typeof UpstreamModelPicker>>(editor.tree(), UpstreamModelPicker)[0]!;
    const base = RECORD.models.map((model) => model.id);
    expect(picker().selected).toEqual(base);
    requests.providers = [{ ...RECORD, updatedAt: 2, models: [...RECORD.models, added] }];
    requests.patch.mockImplementation(async ({ body }: { body: Partial<ProviderRecord> }) => ({
      ...RECORD,
      ...body,
    }));
    const next = removing ? [] : ['small-model', 'large-model'];
    picker().onSave(next, new Map([['large-model', 'Large model']]), base);
    await vi.waitFor(() => expect(requests.patch).toHaveBeenCalledTimes(1));
    const saved = requests.patch.mock.calls[0]![0].body.models.map(
      (model: { id: string }) => model.id,
    );
    expect(saved).toEqual(
      removing ? [added.id] : ['small-model', added.id, 'large-model'],
    );
  },
);

it('C24: the picker reports the selection it opened with, not a refreshed prop', () => {
  const slots: unknown[] = [];
  const onSave = vi.fn();
  let selected = ['small-model'];
  const picker = () =>
    render(slots, () =>
      UpstreamModelPicker({
        endpoint: 'GET https://gateway.example.invalid/v1/models',
        selected,
        load: () => new Promise(() => undefined),
        onClose: () => undefined,
        onSave,
      }),
    );
  picker();
  selected = ['small-model', 'external-model'];
  const shell = propsOf<ComponentProps<typeof DialogShell>>(picker(), DialogShell)[0]!;
  const save = Children.toArray(
    (shell.footer as ReactElement<{ children?: ReactNode }>).props.children,
  )
    .filter((node): node is ReactElement<ComponentProps<typeof Button>> => isValidElement(node))
    .find(
      (node) =>
        node.type === Button && Children.toArray(node.props.children).includes('保存'),
    )!;
  save.props.onClick?.({} as Parameters<NonNullable<typeof save.props.onClick>>[0]);
  expect(onSave).toHaveBeenCalledExactlyOnceWith(
    ['small-model'],
    expect.any(Map),
    ['small-model'],
  );
});

it('C1: retirement stays scoped to the provider whose catalog marked the model dead', () => {
  const shared = { id: 'shared-model', name: 'Shared model' };
  const other: ProviderRecord = {
    ...RECORD,
    id: 'prov-other',
    providerId: 'other-relay',
    label: 'Other gateway',
  };
  requests.providers = [{ ...RECORD, models: [shared] }, { ...other, models: [shared] }];
  requests.sources = [
    {
      runtime: 'pi',
      provider: RECORD.providerId,
      installed: true,
      hostname: 'h',
      models: [{ ...shared, liveness: 'dead' }],
    },
  ];
  const page = pageHarness();
  const editors = propsOf<ComponentProps<typeof TeamProviderEditor>>(page.tree(), TeamProviderEditor);
  expect(editors).toHaveLength(1);
  expect(editors[0]!.deadModels.has('shared-model')).toBe(true);
  const rows = page.rows();
  expect(rows[0]!.statusLabel).toContain('已下架');
  expect(rows[0]!.tone).toBe('warn');
  expect(rows[1]!.statusLabel).not.toContain('已下架');
  expect(rows[1]!.tone).not.toBe('warn');
});

it('C1: merges results by model and uses the latest arrival for each model on the same fingerprint', async () => {
  requests.providers = [{ ...RECORD, models: [...RECORD.models, { id: 'large-model', name: 'Large model' }] }];
  const page = pageHarness();
  let release!: (result: TeamProviderTestResult) => void;
  requests.test.mockImplementationOnce(() => new Promise<TeamProviderTestResult>((resolve) => { release = resolve; }));
  const pending = page.actions().test!('small-model');
  requests.test.mockResolvedValueOnce(OK).mockResolvedValueOnce(OK);
  await page.actions().test!('small-model');
  await page.actions().test!('large-model');
  expect(page.row()).toMatchObject({ tone: 'ok', statusLabel: '可用' });
  release(FAILED);
  await pending;
  expect(page.checks()).toEqual({
    [RECORD.id]: { [RECORD.configurationFingerprint]: { 'small-model': FAILED, 'large-model': OK } },
  });
  expect(page.row()).toMatchObject({ tone: 'fail', statusLabel: '模型不存在' });
});
