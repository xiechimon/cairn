import type { MemoryLayer, MemoryRecord } from '@cairn/shared';

export function isAutoInjected(layer: MemoryLayer | undefined): boolean {
  return layer === undefined || layer === 'core';
}

export function memoriesByLayer(
  memories: MemoryRecord[],
  projectId: string | null,
): { injected: MemoryRecord[]; lookup: MemoryRecord[] } {
  const inScope = memories.filter((memory) => memory.projectId === projectId);
  return {
    injected: inScope.filter((memory) => isAutoInjected(memory.layer)),
    lookup: inScope.filter((memory) => !isAutoInjected(memory.layer)),
  };
}

export function splitMemoryContent(content: string): { summary: string; details: string[] } {
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const [summary = '', ...rest] = lines;
  return { summary, details: rest.map((line) => line.replace(/^[-*]\s+/, '')) };
}
