import { createCn } from 'cn/config';

export const cn = createCn({
  extend: {
    classGroups: {
      'font-size': [{ text: ['page', 'heading', 'card-title', 'ui', 'meta', 'caption'] }],
    },
  },
});
