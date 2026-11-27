import type { DesignCommentRecord } from '@cairn/shared';
import { describe, expect, it } from 'vitest';
import { isSlideDeck } from '../src/board/artifact/slide-deck.js';
import { commentWhere } from '../src/board/design/design-comment-list.js';

describe('isSlideDeck', () => {
  it('treats an html element marked data-slides as a deck', () => {
    expect(isSlideDeck('<!doctype html><html data-slides><body><section class="slide">1</section></body></html>')).toBe(true);
    expect(isSlideDeck('<HTML lang="zh" DATA-SLIDES="1920x1080"><body></body></HTML>')).toBe(true);
  });

  it('keeps a page whose carousel uses section.slide as a page', () => {
    expect(isSlideDeck('<html><body><section class="slide">轮播一</section><section class="slide">轮播二</section></body></html>')).toBe(false);
    expect(isSlideDeck('<html data-slideshow><body></body></html>')).toBe(false);
    expect(isSlideDeck('<html><body><div data-slides></div></body></html>')).toBe(false);
    expect(isSlideDeck('<!-- <html data-slides> --><html><body></body></html>')).toBe(false);
    expect(isSlideDeck('<html title="uses data-slides here"><body></body></html>')).toBe(false);
    expect(isSlideDeck("<html data-note='a > data-slides'><body></body></html>")).toBe(false);
    expect(isSlideDeck('<!doctype html><body><div title="<html data-slides>"></div></body>')).toBe(false);
  });
});

describe('commentWhere on a slide', () => {
  it('names the slide before the element', () => {
    const comment = {
      label: 'b',
      text: '¥1,280 万',
      anchor: { type: 'slide', slide: 3 },
    } as DesignCommentRecord;
    expect(commentWhere(comment)).toBe('第 3 页幻灯片 · b「¥1,280 万」');
  });
});
