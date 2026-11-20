# Real creator UI call-site acceptance — verifier-first plan

Status: DESIGN / NOT CERTIFIED. Isolated diagnostic branch only; application main untouched.

## Physically certified baseline
- Pinned frontend boundary and browser-shaped HTTP transport: exact head `3d3df34b5b8cca75f059a60035ba2adc9334ef8f`, run `44828941827`, job `136608610404`: 10/10 GREEN.
- The physical court imports the real pinned `MovieMentorDurableCreatorWriteBoundary.js` into Node; this is NOT a browser UI call-site test.
- Frontend pinned source `344d98ff0c7e075a7e6530c8871670ad8044d220`, `CreatorMemory.js` lines 771-789: `continueWithDurableServerAuthority` requires strict writer, delegates to boundary, returns `localStateAdopted:false` and `restorationMode:'server-read-only'`.
- The real boundary explicitly states no application caller is wired. It returns `durable-outcome-unknown` on transport errors, not an abort or automatic new-operation retry.

## Required isolated UI examination
1. Identify actual creator screen component and event handler, not merely the memory facade. Document exact call graph and state/render ownership at pinned frontend head.
2. Mount an isolated UI harness with a browser-compatible transport to the isolated authenticated HTTP server; prove the UI sends project/operation/revision/proposed content but cannot supply trusted principal, Mongo connection, admission fence or publication witness.
3. On server receipt, render a separate server-authoritative read-only continuation view. Do not call `replaceState`, `replaceStateWithSharedAuthority`, or locally mark publication witnessed.
4. Fresh browser/session reopens and retrieves canonical state and historical receipts. Prove a second authorized edit uses current canonical revision and an independent operation ID; the old operation ID is reserved for unknown-outcome reconciliation.
5. Two sessions compete on the same revision; exactly one server commit, loser reloads canonical winner, no local writable adoption.
6. Post-commit socket-loss returns unknown outcome to UI; reconcile by the **same** operation ID after reopening; no duplicate receipt, no silent retry with a new ID.
7. Invalid JWT, intruder, stale revision, revoked ownership and forged local data deny mutation and readback; no bypass via legacy local writers.
8. Run the original frontend RED examination unchanged on the same exact candidate head. Never replace its result with the narrower isolated positive court.

## Release gates
- Actual browser UI call site not wired/certified.
- Original frontend RED not resolved.
- Production readiness, local writable restoration, Phase 01 release, merge, deploy and production database writes remain HELD.
