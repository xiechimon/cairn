import { type RefObject, useCallback, useEffect } from 'react';

export type ScrollFadeOrientation = 'vertical' | 'horizontal' | 'both';

export type UseScrollFadeOptions = {
  orientation?: ScrollFadeOrientation;
  fadeSize?: number;
  enabled?: boolean;
};

function readFadeSize(el: HTMLElement, override?: number): number {
  if (override != null) return override;
  const raw = getComputedStyle(el).getPropertyValue('--scroll-fade-size').trim();
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : 28;
}

function clearFadeVars(el: HTMLElement): void {
  el.style.removeProperty('--scroll-fade-top');
  el.style.removeProperty('--scroll-fade-bottom');
  el.style.removeProperty('--scroll-fade-left');
  el.style.removeProperty('--scroll-fade-right');
}

export function scrollFadeClassName(orientation: ScrollFadeOrientation = 'vertical'): string {
  if (orientation === 'horizontal') return 'scroll-fade-h';
  if (orientation === 'both') return 'scroll-fade-both';
  return 'scroll-fade';
}

export function useScrollFade(
  ref: RefObject<HTMLElement | null>,
  options: UseScrollFadeOptions = {},
): void {
  const orientation = options.orientation ?? 'vertical';
  const fadeSize = options.fadeSize;
  const enabled = options.enabled ?? true;

  const sync = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const size = readFadeSize(el, fadeSize);

    if (orientation === 'vertical' || orientation === 'both') {
      const { scrollTop, scrollHeight, clientHeight } = el;
      const atTop = scrollTop <= 2;
      const atBottom = scrollTop + clientHeight >= scrollHeight - 2;
      el.style.setProperty('--scroll-fade-top', atTop ? '0px' : `${size}px`);
      el.style.setProperty('--scroll-fade-bottom', atBottom ? '0px' : `${size}px`);
    }
    if (orientation === 'horizontal' || orientation === 'both') {
      const { scrollLeft, scrollWidth, clientWidth } = el;
      const atLeft = scrollLeft <= 2;
      const atRight = scrollLeft + clientWidth >= scrollWidth - 2;
      el.style.setProperty('--scroll-fade-left', atLeft ? '0px' : `${size}px`);
      el.style.setProperty('--scroll-fade-right', atRight ? '0px' : `${size}px`);
    }
  }, [ref, orientation, fadeSize]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!enabled) {
      clearFadeVars(el);
      return;
    }
    el.style.setProperty('--scroll-fade-top', '0px');
    el.style.setProperty('--scroll-fade-bottom', '0px');
    el.style.setProperty('--scroll-fade-left', '0px');
    el.style.setProperty('--scroll-fade-right', '0px');
    sync();
    el.addEventListener('scroll', sync, { passive: true });
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    const mo = new MutationObserver(sync);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      el.removeEventListener('scroll', sync);
      ro.disconnect();
      mo.disconnect();
      clearFadeVars(el);
    };
  }, [ref, enabled, sync]);
}
