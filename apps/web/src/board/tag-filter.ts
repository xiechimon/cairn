import type { TagChipData } from '../components/ui/tag-chip.js';
import type { TodoRecord } from '../fixtures/records.js';

export interface TagOption {
  name: string;
  color: string;
  count: number;
}

export function parseTagParam(raw: string | null, vocab: readonly string[] | null): string[] {
  if (raw == null || raw === '' || vocab == null) return [];
  const known = new Set(vocab);
  return [...new Set(raw.split(','))].filter((name) => known.has(name)).sort();
}

export function matchesTagFilter(
  todo: TodoRecord,
  selected: ReadonlySet<string>,
  nameById: ReadonlyMap<string, string>,
): boolean {
  if (selected.size === 0) return true;
  if (todo.tagIds.length === 0) return true;
  return todo.tagIds.some((id) => {
    const name = nameById.get(id);
    return name != null && selected.has(name);
  });
}

export function buildTagOptions(
  ordered: readonly TagChipData[],
  todos: readonly TodoRecord[],
  otherAxis: (todo: TodoRecord) => boolean,
  nameById: ReadonlyMap<string, string>,
): TagOption[] {
  const byName = new Map<string, TagOption>();
  for (const tag of ordered) {
    if (byName.has(tag.name)) continue;
    byName.set(tag.name, { name: tag.name, color: tag.color, count: 0 });
  }
  const counts = new Map<string, number>();
  for (const todo of todos) {
    if (!otherAxis(todo)) continue;
    const names = new Set<string>();
    for (const id of todo.tagIds) {
      const name = nameById.get(id);
      if (name != null && byName.has(name)) names.add(name);
    }
    for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...byName.values()]
    .map((option) => ({ ...option, count: counts.get(option.name) ?? 0 }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}

export function cardTag(
  todo: TodoRecord,
  tagById: ReadonlyMap<string, TagChipData>,
): TagChipData | null {
  for (const id of todo.tagIds) {
    const tag = tagById.get(id);
    if (tag != null) return tag;
  }
  return null;
}
