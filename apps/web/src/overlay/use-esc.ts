import { useEffect, useRef } from 'react';
import { dropEscLayer, ensureGestureKeys, pushEscLayer } from '../overlay/gesture-machine.js';

export function useEscClose(onClose: () => void, enabled = true): void {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    if (!enabled) return;
    ensureGestureKeys();
    const id = pushEscLayer(() => onCloseRef.current());
    return () => dropEscLayer(id);
  }, [enabled]);
}
