import { useQuery } from '@tanstack/react-query';
import { fetchWithSession } from '../../../api/auth.js';

async function fetchBytes(src: string): Promise<ArrayBuffer> {
  const res = src.startsWith('data:') ? await fetch(src) : await fetchWithSession(src);
  if (!res.ok) throw new Error(`file read failed: ${res.status}`);
  return res.arrayBuffer();
}

export function useFileBytes(src: string) {
  return useQuery({
    queryKey: ['attachment-bytes', src],
    queryFn: () => fetchBytes(src),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}
