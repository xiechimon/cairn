import { describe, expect, it } from 'vitest';
import { renderDesignCommentBlock } from '../src/records/design.js';

const base = {
  fileName: 'q3-review.html',
  versionSeq: 2,
  pin: 1,
  label: 'b',
  text: '¥1,280 万',
  note: '换成柱状图',
  markAttachmentId: null,
};

describe('renderDesignCommentBlock slide comments', () => {
  it('keeps a structural selector next to the slide for an element without an id', () => {
    const block = renderDesignCommentBlock({
      todoRef: '#14',
      comments: [
        {
          ...base,
          elementId: '',
          selector: 'section.slide:nth-of-type(3) > div:nth-of-type(1) > b',
          anchor: { type: 'slide', slide: 3 },
        },
      ],
    });
    expect(block).toContain(
      '1. q3-review.html v2 · 第 3 页幻灯片 · section.slide:nth-of-type(3) > div:nth-of-type(1) > b（当前文字：「¥1,280 万」）：换成柱状图',
    );
  });

  it('names the annotated element id inside the slide', () => {
    const block = renderDesignCommentBlock({
      todoRef: '#14',
      comments: [
        {
          ...base,
          elementId: 'revenue',
          selector: '[data-od-id="revenue"]',
          anchor: { type: 'slide', slide: 3 },
        },
      ],
    });
    expect(block).toContain('第 3 页幻灯片 · b[data-od-id="revenue"]');
  });
});
