# Real CreatorMemory facade ↔ server provenance integration gate

Status: **NOT CERTIFIED**. Source inspected at frontend `344d98ff0c7e075a7e6530c8871670ad8044d220`.

## Proven independent pieces
- Real facade read-only continuation: frontend exact-head isolated court GREEN; `continueWithDurableServerAuthority` returns `localStateAdopted:false`.
- Server-owned nonempty outbox ledger: diagnostic `73191e5b` exact-head physical Mongo GREEN, run 44785644629, job 136459657348.
- Existing `isolated-server-publication-provenance.mjs` exposes `append/issue/consume` but **not** the `commit/readCommitted` interface required by `MovieMentorDurableCreatorWriteBoundary.js`.
- The server grant consumption method currently returns a boolean, **not** a complete verified snapshot/lease receipt. No real-facade writable adoption method exists.

## Missing bridge — implementation requirements
1. Add diagnostic-only authenticated adapter that implements a compatible read-only server snapshot projection for the real facade. It must validate ownership, committed revision, server-ledger provenance and receipt/readback identity.
2. Physically verify fresh-process read-only recovery with a nonempty server-owned outbox using the real facade, with unchanged local state and no invented publication witness.
3. Design an explicit writable adoption method and receipt separately; do not smuggle `localStateAdopted:true` into read-only continuation or bypass `replaceStateWithSharedAuthority` provenance checks.
4. Run two competing writer processes, revoked owner, stale revision, tampered ledger, socket loss/replay and exact original continuity acceptance on pinned heads. Preserve original RED until that exact court passes.
5. Avoid mixing source statuses: physical server ledger GREEN does not certify the facade-to-ledger BLUE edge.

## Risks to examine
- A server-owned ledger entry's digest only proves equality to the server-stored state; independently check that it was created by the trusted server operation, not imported from client bytes.
- The isolated ledger's current append path does not yet implement idempotent operation replay or durable reconciliation after unknown socket outcome. Add a separate negative court before production adoption.
- The existing adoption grant is a one-shot authority reservation, not an implemented creator write session or publication permission.

No main changes, no production DB writes, no deploy, no merge. VERIFIER FIRST.
