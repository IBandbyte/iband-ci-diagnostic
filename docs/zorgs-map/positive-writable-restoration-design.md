# Positive writable restoration — physical contract (diagnostic only)

## Certified baseline
- Real pinned CreatorMemory facade can read server-origin nonempty publication history without adopting it.
- Isolated Mongo admission fence authenticates owner, consumes a grant once and rejects competing writers.
- Real strict facade refuses direct synchronous write and does not turn a server grant into a process-local publication witness.

## Architectural boundary
The current `replaceStateWithSharedAuthority` is a **browser-local whole-memory writer**. It checks a process-local `witnessedPublicationHistory` and intentionally rejects a nonempty publication ledger recovered in a fresh process. A server admission receipt must **not** set that witness or bypass the check.

A safe positive path therefore needs a distinct **server-owned editing operation**, not a browser-local promotion of a read-only snapshot:

1. The server validates signed owner authentication, project ownership, current ownership revision, admitted operation/fence, unrevoked status, and full publication-ledger provenance **on each edit**, not just at admission.
2. The server performs a transactional compare-and-swap against the canonical revision, admitting exactly one mutation under the current fence. A stale fence, owner, revision, replay, and changed ledger must be denied.
3. Only explicitly allowlisted creator-content fields may change. The client must not replace the canonical outbox, provenance records, ownership, or spend ledger.
4. The server advances the canonical revision and records an idempotent operation receipt in the same Mongo transaction. Socket loss/retry must return the original result, never apply a second edit.
5. Fresh-process restoration returns the canonical state as **read-only** until the new process obtains its own valid server admission. Local persistence cannot be a second writer.
6. A subsequent isolated physical court must prove an **authorized positive edit** survives process restart, two independent competing writers cannot both commit, and a replay/stale fence/intruder/tamper is denied.
7. Only after these server operations pass can a real-facade integration court test editable UI calls routed through the server. Original frontend RED remains held until its exact original court passes.

## Safety hold
No application-main changes, merge, deployment, or production DB write. No claim of real-facade writable adoption from a server-only result.
