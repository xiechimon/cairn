import { type DragEvent, useEffect, useRef, useState } from 'react';

export interface FileDropBind {
  onDragEnter?: (event: DragEvent<HTMLElement>) => void;
  onDragOver?: (event: DragEvent<HTMLElement>) => void;
  onDragLeave?: (event: DragEvent<HTMLElement>) => void;
  onDrop?: (event: DragEvent<HTMLElement>) => void;
}

export function carriesFiles(data: Pick<DataTransfer, 'types'> | null): boolean {
  return data != null && Array.from(data.types).includes('Files');
}

export function useFileDrop(onFiles: ((files: File[]) => void) | undefined): {
  active: boolean;
  bind: FileDropBind;
} {
  const [active, setActive] = useState(false);
  const depthRef = useRef(0);
  useEffect(() => {
    if (!active) return;
    const reset = () => {
      depthRef.current = 0;
      setActive(false);
    };
    window.addEventListener('dragend', reset);
    window.addEventListener('drop', reset);
    return () => {
      window.removeEventListener('dragend', reset);
      window.removeEventListener('drop', reset);
    };
  }, [active]);
  if (onFiles === undefined) return { active: false, bind: {} };
  return {
    active,
    bind: {
      onDragEnter: (event) => {
        if (!carriesFiles(event.dataTransfer)) return;
        event.preventDefault();
        depthRef.current += 1;
        setActive(true);
      },
      onDragOver: (event) => {
        if (!carriesFiles(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      },
      onDragLeave: (event) => {
        if (!carriesFiles(event.dataTransfer)) return;
        depthRef.current = Math.max(0, depthRef.current - 1);
        if (depthRef.current === 0) setActive(false);
      },
      onDrop: (event) => {
        if (!carriesFiles(event.dataTransfer)) return;
        event.preventDefault();
        depthRef.current = 0;
        setActive(false);
        const files = Array.from(event.dataTransfer.files);
        if (files.length > 0) onFiles(files);
      },
    },
  };
}
