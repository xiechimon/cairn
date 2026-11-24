export function createScopedTokenCache<T>(options: {
  reuseUntil: (value: T) => number;
  now?: () => number;
  onInsert?: (value: T) => void;
  onRemove?: (value: T) => void;
}): (key: string, force: boolean, load: () => Promise<T>) => Promise<T>;
