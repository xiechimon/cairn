export function streamEventCarriesContent(event: { type: string; delta?: string }): boolean {
  if (event.type === 'done' || event.type === 'toolcall_start') return true;
  return typeof event.delta === 'string' && event.delta.length > 0;
}

export async function pipeStreamRetriedBeforeContent<
  Event extends { type: string; delta?: string },
  Err,
>(
  start: () => AsyncIterable<Event>,
  isError: (event: Event) => Err | undefined,
  retry: (error: Err) => boolean,
  push: (event: Event) => void,
): Promise<void> {
  const held: Event[] = [];
  let streaming = false;
  for await (const event of start()) {
    const error = isError(event);
    if (error !== undefined && !streaming) {
      if (retry(error)) {
        for await (const next of start()) push(next);
        return;
      }
      for (const earlier of held) push(earlier);
      push(event);
      return;
    }
    if (!streaming && streamEventCarriesContent(event)) {
      streaming = true;
      for (const earlier of held.splice(0)) push(earlier);
    }
    if (streaming) push(event);
    else held.push(event);
  }
}
