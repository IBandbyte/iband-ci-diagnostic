# Writable adoption: verified authority contract (diagnostic only)

## Evidence boundary
- Read-only real CreatorMemory facade with nonempty server-origin publication provenance: GREEN at [44786342680](https://github.com/IBandbyte/iband-ci-diagnostic/actions/runs/44786342680/job/136462091572).
- Two independent contenders, one server-origin nonempty publication adoption-grant winner, replay/intruder denied: GREEN at [44787330990](https://github.com/IBandbyte/iband-ci-diagnostic/actions/runs/44787330990/job/136465532662).
- Neither court authorizes a writable CreatorMemory facade, browser-local publication witness, or editable restoration. Original frontend continuity RED remains unchanged.

## Real facade constraints observed at pinned frontend 344d98ff
1. `continueWithDurableServerAuthority` intentionally returns `localStateAdopted:false`, `restorationMode:'server-read-only'` and never changes the facade's local working cache.
2. `replaceStateWithSharedAuthority` explicitly rejects nonempty persisted publication outboxes without a **matching process-local witness**. A grant token or hash alone must not bypass this check.
3. `adoptPersistedStateWithoutWrite` is an internal synchronous shield, not a public remote authority entry point. It must not be invoked merely because an isolated Mongo grant was consumed.
4. Strict ordinary synchronous writes remain denied until a real, shared writer boundary is proven. No isolated test may mutate frontend main or production storage.

## Required server-owned protocol
- **Issue** an authenticated, project-scoped, revision-scoped, ownership-revision-scoped, short-lived adoption capability only after validating every publication outbox entry against the server's atomic ledger.
- **Acquire** it exactly once with a transactional compare-and-swap on project revision, owner, ownership revision and active writer lease. A second writer, stale owner, replay and revoked project must fail closed.
- **Read back** a canonical snapshot and immutable receipt in a fresh process, validating grant, ownership, revision, complete outbox/ledger, state digest, and operation ID. Receipt cannot be self-attested by browser storage.
- **Adopt** into a separately designed strict facade method only while exclusive cross-context writer authority is held, after trusted readback; prevent unverified publication witness elevation and forbid silent overwrite of newer local state.
- **Resume** ordinary editing only after server lease and local writer coordination agree. Every later write must revalidate current lease/fence or fail closed.
- **Unknown outcome** after network/socket loss must reconcile by operation ID from a fresh process; never issue a second authority grant speculatively.
- **Release/revoke** must invalidate old fencing tokens and refuse stale writers even if they retain a prior snapshot.

## Physical acceptance courts to implement
1. Signed owner + nonempty ledger positive, exact snapshot and readback; no unauthorized local persistence.
2. Two independent real facades racing for the same project; only one may become writable; loser stays read-only.
3. Restart with durable publication history, reauthenticated ownership and fresh lease; no reused process-local witness.
4. Tampered local storage/outbox, changed ownership revision, revoked owner, stale revision, missing ledger entry, reused grant and stale fence must all deny.
5. Socket loss after authority commit, unknown outcome recovery, exactly-once lease/adoption semantics.
6. Finally rerun the **original unchanged frontend continuity test**. Do not relabel isolated GREEN as original acceptance.

## Hold
Do not implement writable local state adoption by calling `replaceState`, `adoptPersistedStateWithoutWrite`, or setting `witnessedPublicationHistory` from a server grant alone. The new facade method and server lease protocol must be reviewed and physically verified first.

VERIFIER FIRST / PHASE 01 HELD / no application main / no production writes / no deploy / no merge.
