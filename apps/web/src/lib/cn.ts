import { createCn } from 'cn/config';

export const cn = createCn({
  extend: {
    classGroups: {
      'font-size': [
        { text: ['greeting', 'page', 'heading', 'card-title', 'ui', 'meta', 'code', 'caption'] },
      ],
    },
  },
});
