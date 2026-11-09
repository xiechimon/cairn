import { createCn } from 'cn/config';

export const cn = createCn({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: [
            'greeting',
            'page',
            'brand',
            'heading',
            'card-title',
            'ui',
            'meta',
            'code',
            'caption',
            'code-block',
            'code-inline',
            'code-lang',
          ],
        },
      ],
    },
  },
});
