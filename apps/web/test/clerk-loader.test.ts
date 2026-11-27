import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadClerkScript } from '../src/lib/clerk-loader.js';

describe('loadClerkScript', () => {
  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;

  afterEach(() => {
    if (prevWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      globalThis.window = prevWindow;
    }
    if (prevDocument === undefined) {
      delete (globalThis as { document?: unknown }).document;
    } else {
      globalThis.document = prevDocument;
    }
  });

  it('loads @clerk/ui@1 and @clerk/clerk-js@6 from Clerk FAPI and injects ClerkUI into load()', async () => {
    const created: {
      src: string;
      async: boolean;
      crossOrigin: string;
      dataset: Record<string, string>;
      onload: (() => void) | null;
      onerror: (() => void) | null;
    }[] = [];
    const loadSpy = vi.fn(async (_opts?: Record<string, unknown>) => {});
    const fakeUiCtor = class FakeClerkUI {};
    const fakeClerk = {
      load: loadSpy,
      user: null,
      session: null,
      mountSignIn: () => {},
      unmountSignIn: () => {},
      signOut: async () => {},
      addListener: () => () => {},
    };
    const fakeWindow = {
      Clerk: undefined as typeof fakeClerk | undefined,
      __internal_ClerkUICtor: undefined as unknown,
    };

    (globalThis as unknown as { window: typeof fakeWindow }).window = fakeWindow;
    (globalThis as unknown as { document: unknown }).document = {
      querySelector: () => null,
      createElement: () => ({
        src: '',
        async: false,
        crossOrigin: '',
        dataset: {} as Record<string, string>,
        onload: null as (() => void) | null,
        onerror: null as (() => void) | null,
      }),
      head: {
        appendChild: (el: (typeof created)[number]) => {
          created.push(el);
          if (el.src.includes('@clerk/ui@1')) {
            fakeWindow.__internal_ClerkUICtor = fakeUiCtor;
          } else {
            fakeWindow.Clerk = fakeClerk;
          }
          el.onload?.();
        },
      },
    };

    const loaded = await loadClerkScript(
      'https://infinite-kodiak-9841.clerk.accounts.dev',
      'pk_test_example',
    );
    expect(loaded).toBe(fakeClerk);
    expect(created.map((s) => s.src)).toContain(
      'https://infinite-kodiak-9841.clerk.accounts.dev/npm/@clerk/ui@1/dist/ui.browser.js',
    );
    expect(created.map((s) => s.src)).toContain(
      'https://infinite-kodiak-9841.clerk.accounts.dev/npm/@clerk/clerk-js@6/dist/clerk.browser.js',
    );
    const clerkScript = created.find((s) => s.src.includes('@clerk/clerk-js@6'));
    expect(clerkScript?.dataset.clerkPublishableKey).toBe('pk_test_example');

    await loaded.load();
    expect(loadSpy).toHaveBeenCalledWith({ ui: { ClerkUI: fakeUiCtor } });
  });
});
