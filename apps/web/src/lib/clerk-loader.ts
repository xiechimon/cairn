export interface ClerkBrowserGlobal {
  load: () => Promise<void>;
  user: unknown;
  session: { getToken: () => Promise<string | null> } | null;
  mountSignIn: (node: HTMLDivElement) => void;
  unmountSignIn: (node: HTMLDivElement) => void;
  signOut: () => Promise<void>;
  addListener: (listener: () => void) => () => void;
}

declare global {
  interface Window {
    Clerk?: ClerkBrowserGlobal;
  }
}

export function loadClerkScript(
  issuer: string,
  publishableKey: string,
): Promise<ClerkBrowserGlobal> {
  if (window.Clerk !== undefined) return Promise.resolve(window.Clerk);
  const parsed = new URL(issuer);
  if (parsed.protocol !== 'https:' || parsed.hostname === '') {
    return Promise.reject(new Error('invalid clerk issuer'));
  }
  const src = `https://${parsed.host}/npm/@clerk/clerk-js@5/dist/clerk.browser.js`;
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-cairn-clerk="1"]');
    if (existing !== null) {
      existing.addEventListener('load', () => {
        if (window.Clerk !== undefined) resolve(window.Clerk);
        else reject(new Error('clerk unavailable'));
      });
      existing.addEventListener('error', () => reject(new Error('clerk script failed')));
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.dataset.cairnClerk = '1';
    script.dataset.clerkPublishableKey = publishableKey;
    script.onload = () => {
      if (window.Clerk !== undefined) resolve(window.Clerk);
      else reject(new Error('clerk unavailable'));
    };
    script.onerror = () => reject(new Error('clerk script failed'));
    document.head.appendChild(script);
  });
}
