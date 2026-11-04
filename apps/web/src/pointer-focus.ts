const QUIET_KEYS = new Set(['Escape', 'Shift', 'Control', 'Alt', 'Meta']);

// Chromium counts Escape as keyboard interaction and turns :focus-visible on
// for an element that was focused by a mouse click.
export function trackPointerFocus(doc: Document = document): void {
  const root = doc.documentElement;
  doc.addEventListener(
    'pointerdown',
    () => {
      root.dataset.pointerFocus = '';
    },
    true,
  );
  doc.addEventListener(
    'keydown',
    (event) => {
      if (!QUIET_KEYS.has(event.key)) delete root.dataset.pointerFocus;
    },
    true,
  );
}
