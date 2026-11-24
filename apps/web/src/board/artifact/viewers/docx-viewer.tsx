import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Skeleton } from '../../../components/ui/skeleton.js';
import { useFileBytes } from './use-file-bytes.js';

export function DocxViewer({ src, fallback }: { src: string; fallback: ReactNode }) {
  const bytesQ = useFileBytes(src);
  const host = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<'rendering' | 'drawn' | 'failed'>('rendering');
  const bytes = bytesQ.data;
  useEffect(() => {
    const element = host.current;
    if (element === null || bytes === undefined) return;
    let live = true;
    setState('rendering');
    void import('docx-preview')
      .then(({ renderAsync }) =>
        renderAsync(bytes.slice(0), element, undefined, {
          inWrapper: true,
          ignoreLastRenderedPageBreak: false,
          experimental: true,
          useBase64URL: true,
        }),
      )
      .then(
        () => live && setState('drawn'),
        () => live && setState('failed'),
      );
    return () => {
      live = false;
      element.replaceChildren();
    };
  }, [bytes]);
  if (bytesQ.isError || state === 'failed') return <>{fallback}</>;
  return (
    <div
      data-testid="artifact-docx"
      data-state={state}
      className="relative min-h-0 flex-1 overflow-auto overscroll-contain bg-(--surface-1)"
    >
      {state === 'rendering' && (
        <Skeleton className="absolute inset-x-4 top-4 aspect-[1/1.414] max-w-2xl rounded-none" />
      )}
      <div ref={host} className="artifact-docx" />
    </div>
  );
}
