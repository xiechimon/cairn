// The bare `cn` specifier resolves here (vite.config.ts, vitest.config.ts,
// tsconfig.json paths), so registry files under components/ui keep their
// upstream `import { cn } from 'cn'` byte-for-byte. Without this, cn 0.4 reads
// the app.css @theme font-size keys as text colors and drops one of the pair.
import { createCn } from 'cn/config';

export const cn = createCn({
  extend: {
    classGroups: {
      'font-size': [{ text: ['page', 'heading', 'card-title', 'ui', 'meta', 'caption'] }],
    },
  },
});
