import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { designSrcdoc, injectBeforeBodyEnd } from '../design/srcdoc.js';
import { DECK_KEYS } from './viewers/deck-pager.js';

export const SLIDE_SIZE = { width: 1920, height: 1080 } as const;

const DECK_MESSAGES = {
  ready: 'cairn:deck-ready',
  key: 'cairn:deck-key',
  show: 'cairn:deck-show',
  shown: 'cairn:deck-shown',
} as const;

const HTML_START_TAG = /^\s*(?:<!doctype[^>]*>\s*)?<html(?=[\s>/])((?:[^>"']|"[^"]*"|'[^']*')*)>/i;
const ATTRIBUTE = /([^\s"'=<>/`]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;

export function isSlideDeck(html: string): boolean {
  const attributes = HTML_START_TAG.exec(
    html.replace(/^\uFEFF/, '').replace(/<!--[\s\S]*?-->/g, ''),
  )?.[1];
  if (attributes === undefined) return false;
  return Array.from(attributes.matchAll(ATTRIBUTE), (match) => match[1]?.toLowerCase()).includes(
    'data-slides',
  );
}

function deckPayload(): string {
  const { width, height } = SLIDE_SIZE;
  const keys = JSON.stringify(Object.keys(DECK_KEYS));
  return `<style data-cairn-deck>html[data-cairn-deck],html[data-cairn-deck] body{margin:0!important;width:${width}px;height:${height}px;overflow:hidden!important}[data-cairn-slide]{position:fixed!important;left:0!important;top:0!important;width:${width}px!important;height:${height}px!important;margin:0!important;box-sizing:border-box;overflow:hidden!important;transform:none!important}[data-cairn-slide]:not([data-cairn-on]),[data-cairn-slide]:not([data-cairn-on]) *{visibility:hidden!important}</style><script data-cairn-deck>(function(){
  var slides = Array.prototype.filter.call(document.querySelectorAll('section.slide'), function(s){ return !(s.parentElement && s.parentElement.closest('section.slide')); });
  slides.forEach(function(s, i){ s.setAttribute('data-cairn-slide', String(i + 1)); });
  if (slides.length === 0) { window.parent.postMessage({ type: '${DECK_MESSAGES.ready}', count: 0 }, '*'); return; }
  document.documentElement.setAttribute('data-cairn-deck', '');
  function show(n){ slides.forEach(function(s, i){ if (i === n) s.setAttribute('data-cairn-on', ''); else s.removeAttribute('data-cairn-on'); }); window.parent.postMessage({ type: '${DECK_MESSAGES.shown}', index: n }, '*'); }
  slides[0].setAttribute('data-cairn-on', '');
  var KEYS = ${keys};
  function editable(el){ return !!(el && el.nodeType === 1 && (el.isContentEditable || (el.closest && el.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')))); }
  window.addEventListener('message', function(ev){
    var data = ev && ev.data;
    if (data && data.type === '${DECK_MESSAGES.show}' && typeof data.index === 'number') show(data.index);
  });
  function onKeyDown(ev){
    if (ev.isComposing || ev.defaultPrevented || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (KEYS.indexOf(ev.key) < 0 || editable(ev.target)) return;
    ev.preventDefault();
    window.parent.postMessage({ type: '${DECK_MESSAGES.key}', key: ev.key }, '*');
  }
  document.addEventListener('keydown', onKeyDown);
  window.parent.postMessage({ type: '${DECK_MESSAGES.ready}', count: slides.length }, '*');
})();</script>`;
}

export function deckSrcdoc(html: string): string {
  return injectBeforeBodyEnd(designSrcdoc(html), deckPayload());
}

export interface SlideDeck {
  count: number | null;
  slide: number;
  shown: number | null;
  go: (index: number) => void;
  step: (delta: number) => void;
}

interface FrameDeck {
  key: string;
  count: number | null;
  shown: number | null;
}

export function useSlideDeck(
  frameRef: RefObject<HTMLIFrameElement | null>,
  docKey: string,
): SlideDeck {
  const [frameDeck, setFrameDeck] = useState<FrameDeck>({ key: docKey, count: null, shown: null });
  const current = frameDeck.key === docKey ? frameDeck : { key: docKey, count: null, shown: null };
  const { count, shown } = current;
  const [wanted, setWanted] = useState(0);
  const last = count === null ? Number.POSITIVE_INFINITY : Math.max(0, count - 1);
  const slide = Math.min(wanted, last);
  const slideRef = useRef(slide);
  slideRef.current = slide;
  const lastRef = useRef(last);
  lastRef.current = last;
  const keyRef = useRef(docKey);
  keyRef.current = docKey;
  const go = useCallback(
    (index: number) => setWanted(Math.min(lastRef.current, Math.max(0, index))),
    [],
  );
  const step = useCallback(
    (delta: number) =>
      setWanted((at) =>
        Math.min(lastRef.current, Math.max(0, Math.min(at, lastRef.current) + delta)),
      ),
    [],
  );
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frame = frameRef.current?.contentWindow;
      if (frame == null || event.source !== frame) return;
      const data: unknown = event.data;
      if (typeof data !== 'object' || data === null) return;
      const message = data as Record<string, unknown>;
      const key = keyRef.current;
      if (message.type === DECK_MESSAGES.ready && typeof message.count === 'number') {
        const total = message.count;
        setFrameDeck({ key, count: total, shown: total > 0 ? 0 : null });
        if (total > 0)
          frame.postMessage(
            { type: DECK_MESSAGES.show, index: Math.min(slideRef.current, total - 1) },
            '*',
          );
      } else if (message.type === DECK_MESSAGES.shown && typeof message.index === 'number') {
        const index = message.index;
        setFrameDeck((was) => (was.key === key ? { ...was, shown: index } : was));
      } else if (message.type === DECK_MESSAGES.key && typeof message.key === 'string') {
        const delta = DECK_KEYS[message.key];
        if (delta !== undefined) step(delta);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [frameRef, step]);
  useEffect(() => {
    if (count === null || count === 0) return;
    frameRef.current?.contentWindow?.postMessage({ type: DECK_MESSAGES.show, index: slide }, '*');
  }, [frameRef, slide, count]);
  return { count, slide, shown, go, step };
}
