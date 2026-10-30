import { Toaster, toastError, toastSuccess } from '@cairn/web';
import { useEffect } from 'react';

export const Stack = () => {
  useEffect(() => {
    toastSuccess('PR #2156 merged into main');
    toastError('Build failed for task #104', new Error('typecheck reported 3 errors in apps/server'));
  }, []);
  return (
    <div style={{ position: 'relative', width: 420, height: 220 }}>
      <Toaster theme="light" expand position="bottom-left" duration={60000} />
    </div>
  );
};
