export interface ClerkBrowserGlobal {
  load: (options?: Record<string, unknown>) => Promise<void>;
  user: unknown;
  session: { getToken: () => Promise<string | null> } | null;
  mountSignIn: (node: HTMLDivElement, props?: Record<string, unknown>) => void;
  unmountSignIn: (node: HTMLDivElement) => void;
  signOut: () => Promise<void>;
  addListener: (listener: () => void) => () => void;
}

declare global {
  interface Window {
    Clerk?: ClerkBrowserGlobal;
    __internal_ClerkUICtor?: unknown;
  }
}

const wrappedClerks = new WeakSet<ClerkBrowserGlobal>();

function withClerkUi(clerk: ClerkBrowserGlobal): ClerkBrowserGlobal {
  if (wrappedClerks.has(clerk)) return clerk;
  const originalLoad = clerk.load.bind(clerk);
  clerk.load = (options?: Record<string, unknown>) => {
    if (options?.ui === undefined && window.__internal_ClerkUICtor !== undefined) {
      return originalLoad({ ...options, ui: { ClerkUI: window.__internal_ClerkUICtor } });
    }
    return originalLoad(options);
  };
  wrappedClerks.add(clerk);
  return clerk;
}

function loadScriptTag(
  src: string,
  selector: string,
  datasetKey: 'cairnClerk' | 'cairnClerkUi',
  publishableKey?: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(selector);
    if (existing !== null) {
      if (existing.dataset.cairnLoaded === '1') {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('clerk script failed')));
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.dataset[datasetKey] = '1';
    if (publishableKey !== undefined) {
      script.dataset.clerkPublishableKey = publishableKey;
    }
    script.onload = () => {
      script.dataset.cairnLoaded = '1';
      resolve();
    };
    script.onerror = () => reject(new Error('clerk script failed'));
    document.head.appendChild(script);
  });
}

export async function loadClerkScript(
  issuer: string,
  publishableKey: string,
): Promise<ClerkBrowserGlobal> {
  if (window.Clerk !== undefined) return withClerkUi(window.Clerk);
  const parsed = new URL(issuer);
  if (parsed.protocol !== 'https:' || parsed.hostname === '') {
    throw new Error('invalid clerk issuer');
  }
  const uiSrc = `https://${parsed.host}/npm/@clerk/ui@1/dist/ui.browser.js`;
  const clerkSrc = `https://${parsed.host}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`;
  await Promise.all([
    loadScriptTag(uiSrc, 'script[data-cairn-clerk-ui="1"]', 'cairnClerkUi'),
    loadScriptTag(clerkSrc, 'script[data-cairn-clerk="1"]', 'cairnClerk', publishableKey),
  ]);
  if (window.Clerk === undefined) {
    throw new Error('clerk unavailable');
  }
  return withClerkUi(window.Clerk);
}
