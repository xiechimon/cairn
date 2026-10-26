import type { Page } from '@playwright/test';

export interface LowContrast {
  kind: 'text' | 'kbd' | 'disabled' | 'placeholder';
  text: string;
  ratio: number;
  need: number;
}

export function findLowContrast(page: Page): Promise<LowContrast[]> {
  return page.evaluate(() => {
    type Rgba = [number, number, number, number];
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('canvas 2d unavailable');
    const parse = (color: string): Rgba => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#000';
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    };
    const blend = (top: Rgba, bottom: Rgba): Rgba => {
      const a = top[3];
      return [top[0] * a + bottom[0] * (1 - a), top[1] * a + bottom[1] * (1 - a), top[2] * a + bottom[2] * (1 - a), 1];
    };
    const backdrop = (el: Element): Rgba => {
      const layers: Rgba[] = [];
      for (let e: Element | null = el; e; e = e.parentElement) {
        const layer = parse(getComputedStyle(e).backgroundColor);
        if (layer[3] > 0) layers.push(layer);
        if (layer[3] >= 1) break;
      }
      return layers.reduceRight<Rgba>((under, layer) => blend(layer, under), [255, 255, 255, 1]);
    };
    const opacity = (el: Element) => {
      let value = 1;
      for (let e: Element | null = el; e; e = e.parentElement) value *= Number(getComputedStyle(e).opacity);
      return value;
    };
    const luminance = ([r, g, b]: Rgba) => {
      const channel = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const contrast = (a: Rgba, b: Rgba) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };

    const found: LowContrast[] = [];
    const seen = new Set<string>();
    const check = (el: Element, color: string, kind: LowContrast['kind'], text: string) => {
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (box.width === 0 || box.height === 0 || style.visibility === 'hidden') return;
      const alpha = opacity(el);
      if (alpha === 0 || el.closest('.sr-only')) return;
      const under = backdrop(el);
      const ink = parse(color);
      const ratio = contrast(blend([ink[0], ink[1], ink[2], ink[3] * alpha], under), under);
      const size = Number.parseFloat(style.fontSize);
      const large = size >= 24 || (Number(style.fontWeight) >= 700 && size >= 18.66);
      const need = kind === 'disabled' || large ? 3 : 4.5;
      const key = `${kind}|${text}`;
      if (ratio < need && !seen.has(key)) {
        seen.add(key);
        found.push({ kind, text: text.slice(0, 40), ratio: Math.round(ratio * 100) / 100, need });
      }
    };

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim();
      const el = node.parentElement;
      if (!text || !el || el.closest('script, style, svg')) continue;
      const inKbd = el.closest('kbd') !== null;
      if (!inKbd && el.closest('[aria-hidden="true"]')) continue;
      const kind = inKbd ? 'kbd' : el.closest(':disabled, [aria-disabled="true"]') ? 'disabled' : 'text';
      check(el, getComputedStyle(el).color, kind, text);
    }
    for (const el of document.querySelectorAll('input[placeholder], textarea[placeholder]')) {
      const placeholder = el.getAttribute('placeholder');
      if (placeholder) check(el, getComputedStyle(el, '::placeholder').color, 'placeholder', placeholder);
    }
    return found;
  });
}
