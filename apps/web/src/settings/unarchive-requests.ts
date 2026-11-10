import type { ApiMutations } from '../api/hooks.js';

export type InFlightIds = ReadonlySet<string>;
type SetInFlight = (update: (ids: InFlightIds) => InFlightIds) => void;

export function startUnarchive(
  id: string,
  inFlight: InFlightIds,
  setInFlight: SetInFlight,
  mutation: ApiMutations['setProjectArchived'],
  onError: (error: unknown) => void,
): void {
  if (inFlight.has(id)) return;
  setInFlight((ids) => new Set(ids).add(id));
  mutation
    .mutateAsync({ id, archived: false })
    .catch(onError)
    .finally(() =>
      setInFlight((ids) => {
        const next = new Set(ids);
        next.delete(id);
        return next;
      }),
    );
}
