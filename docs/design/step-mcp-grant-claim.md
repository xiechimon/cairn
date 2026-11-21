# A step's MCP connector grant is bound to its claim (#5141)

The step token computed a step's MCP connector grant from the *current*
policy (`stepMcpGrant` over `machine.capabilities` plus `connectorSlugs`)
every time a Runner asked for it. A connector the owner adds between the
claim and the token call had its URL and headers delivered to the Runner
holding the step, although the claim never granted it. The connector
broker (`executeConnectorToolCall`, reached through `relayTool`) resolved
an endpoint for any team connector the model named, with no reference to
what the claim handed out.

## Persisted state

`step.mcpGrant`: nullable JSON `string[]` of lowercased slugs — the grant
the claim handed out.

- `NULL` — no managed grant recorded: rows claimed before the column
  existed, and claims that hand out no `mcpServers` field (daemon below
  `MCP_MIN_CLI_VERSION`; in-server info-card steps).
- `[]` — a recorded empty grant (locked turn: `mail:`/memory-edit prompt,
  or a relay-only info-card plan on a Runner).
- `[slug, …]` — the recorded grant, the same array the claim sends as
  `mcpServers`: the machine's local MCP slugs ∪ team connector slugs.
  For an in-server chief claim, which has no daemon mount, it is the
  team connector slugs the turn's tool defs cover. The union is
  intentional — it is the set the claim hands out; the broker only ever
  sees `connector_*` slugs inside it.

## Writers

Every transition into `claimed` writes `mcpGrant` in the same UPDATE that
flips `status`, so the grant is atomic with the claim:

| claim path | grant written |
|---|---|
| worker step on a Runner (`tryClaim`, machine-claim.ts) | `stepMcpGrant(db, machineRow, infoPlan !== null) ?? null` — the `workerMcp` array sent as `mcpServers` |
| chief turn on a Runner (`buildChiefClaim` → `claimPendingChiefStep`) | `stepMcpGrant(db, machineRow, locked)` — the `chiefMcp` array sent |
| chief turn in-server (`claimHead` → `claimPendingChiefStep`, `machineId` null) | `connectorSlugs(db, teamId)` — the ceiling the claim hands out; `refuseRestrictedTurnTool` and the `untrustedTurn` owner-approval flow bound mail/memory-edit turns further |
| in-server info-card step (info-card-runner.ts) | `NULL` — the claim hands out no MCP set |

Every transition back to `pending` clears `mcpGrant` next to
`machineId: null`: `releaseClaimedStep` (build abandon sweep),
`holdStepForQuota`, `requeueStep` (model fallback),
`sweepAbandonedChiefSteps`, `sweepQuotaWaitSteps`, and `handBackClaimed`
(claude rate-limit hand-back). A re-claim writes the new claim's grant —
a re-claimed step is bound to the policy of the claim that runs it.

`locked` is `chiefTurnLocked(stepRow)` (`mail:` or memory-edit prompt);
the token path's old `locked` parameter is deleted — it was mail-only and
delivered connector credentials to memory-edit turns that the claim had
locked, the same bug class.

## Readers

1. **Token mint** (`stepToken` → `connectorFields`, worker and
   Runner-chief alike): delivers `persisted ∩ stepMcpGrant(db, machineRow)`
   — lowercased, `NULL → []`, below-gate `undefined → []`. The
   `stillClaimedBy` re-check after the async endpoint fetch is unchanged.
2. **Connector broker** (`executeConnectorToolCall`, reached through
   `executeRelayToolCall` for machine-claimed chief turns and for the
   in-server runtime): `ConnectorCallContext.mcpGrant` carries the claimed
   step's column; a connector slug outside it is refused `403` and
   journaled `error`. `cairn-mail` keeps its earlier branch — it is not an
   `mcpConnector` row. Worker steps never reach this code (`kind !==
   'chief'` returns earlier).
3. **Re-claim**: no reader — the next claim's UPDATE overwrites the value.

## Failure behavior

- Step claimed before the column exists (`NULL`): token delivers no
  connectors and the broker refuses connector calls — fails closed; a
  release/re-claim records a fresh grant.
- Connector added after the claim: not in `persisted`, so the token never
  delivers it and the broker refuses it. This is the fix.
- Connector removed or revoked after the claim: `∩ current` and the
  `mcpConnector` row lookup drop it — same as today.
- Machine downgraded between claim and token (`mcpConnectors` off, CLI
  below the gate): `current` lacks the slugs, the intersection is empty,
  nothing is delivered.
- Token racing a re-claim: the `claimedAt` mismatch is caught by
  `stillClaimedBy`, `{}` is returned.
- In-server step (`machineId` null): `connectorFields` returns `{}` as
  before; the turn's only connector surface is the broker, bound by its
  own `mcpGrant`.

## Tests

- `mcp-connector-wire.test.ts`, worker: a step claimed while the team has
  `linear`, with `notion` added before the token call, gets `linear` only
  (old code delivers both).
- Same shape for a chief turn on a Runner (`coordinatorWorld`).
- A step released to pending and re-claimed after `notion` was added gets
  both — the new claim's grant.
- A claimed row whose `mcpGrant` was cleared to `NULL` gets nothing.
- Relay level (`outbound-untrusted-turn.test.ts` shape): a claimed chief
  step carrying `mcpGrant: []` calling `connector_gmail__…` is refused
  (old code executes the call); with `['gmail']` it proceeds.
