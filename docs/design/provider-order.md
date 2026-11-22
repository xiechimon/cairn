# Provider order

The owner drags providers in Settings > Models into the order he wants, and every list of providers and every model picker follows that order.

## State

`team.providerOrder`: a JSON array of provider keys, nullable.

- A key is `subscription:<id>` for a Claude, Devin or Antigravity subscription and `provider:<id>` for a custom endpoint or API key provider. These are the item ids the providers list already uses.
- `null` means the team never reordered. Every reader then keeps today's order: Claude, Devin and Antigravity subscriptions, then endpoints by creation time.

## Transitions

| From | Event | To |
|---|---|---|
| `null` or a list | The owner drops a row (pointer or keyboard) | The full list of keys currently shown, in the new order |
| A list | A provider is added | Unchanged; the new key has no rank and sorts after every ranked key |
| A list | A provider is removed | Unchanged; the stale key ranks nothing and is gone after the next write |

A write always replaces the whole list. Last write wins; two tabs that reorder at once end with the later drop.

## Readers

1. `GET /api/teams/:id/providers` returns `order` beside `providers`. The providers page sorts its rows with `orderByKeys`: ranked keys by rank, unranked keys after them in their default order.
2. `GET /api/teams/:id/model-sources` sorts sources with the same rule. An endpoint source ranks by its `provider:<id>` key; the Claude Code, Devin and Antigravity sources rank by the best rank among that vendor's subscriptions. Every model picker builds its options from these sources, so the pickers follow the order.

## Writers

1. `PUT /api/teams/:id/provider-order` with `{ order: string[] }`. The body is at most 500 unique keys of at most 200 characters, each starting with `subscription:` or `provider:`; anything else is a 400. The route stores the list and returns it.

## Failure behaviour

- The PUT fails or the network drops: the page has already shown the new order (optimistic cache write); it puts the previous order back and shows a notice that the order was not saved.
- A stored value that is not an array of strings reads as `null`.
- Keys for providers that no longer exist are ignored by every reader.

## Tests

- Server: the PUT stores the order, the providers envelope returns it, model sources follow it, and an invalid body is refused (`apps/server/test/provider-order.test.ts`).
- Web: dragging a row anywhere on it (mouse past 4px, or a 250ms touch hold) and moving it with Space and the arrow keys on its focused row button both reorder the list and send the new order; a failed save puts the old order back (`apps/web/e2e/providers-order.spec.ts`).
