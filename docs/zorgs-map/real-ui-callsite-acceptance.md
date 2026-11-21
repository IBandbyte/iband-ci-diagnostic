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

## Pinned real UI call-path reconnaissance (2026-11-21; source inspection, NOT certification)
- `src/components/studio/CreatorWorkspace.jsx`: mounts `MovieMentorConversation` (around line 330); owns `handleMovieMessage` (around lines 226-241). Creator messages call `identityRuntime.recordPendingCreatorMessage`; mentor messages call asynchronous `identityRuntime.settleConversationMessage` with an error/retained-pending-turn path.
- `src/components/studio/mentor/MovieMentorConversation.jsx`: wraps `MovieMentorConversationCore`, forwards messages through `publishMessage` (lines 66-74), suppresses already-published mentor turn IDs, and re-emits recovered pending creator turns (lines 54-64).
- `src/components/studio/mentor/MovieMentorConversationCore.jsx`: actual textarea/Send button invokes `handleSend` (around line 73), calls `onSendMessage(creatorMessage)`, then `requestMovieMentorTurn`, then `onMentorTurnResult`, then `onSendMessage(mentorMessage)`. This is the visible conversation route, NOT a call to the isolated server-owned creator edit boundary.
- `src/components/studio/mentor/MovieMentorStudioIdentityRuntime.js`: constructs strict-writer `createCreatorMemory({requireSharedWriteAuthority:true})` (around line 115) and exposes conversation resume/settlement operations.
- `src/components/studio/mentor/CreatorMemory.js`: `continueWithDurableServerAuthority` (lines 771-789) delegates to the pinned boundary, returns server-read-only snapshot with `localStateAdopted:false`. No UI caller of this method was observed in inspected components. No assertion of complete repository-wide absence until exact pinned-head code search or equivalent exhaustive audit.

**Engineering conclusion:** the existing visible chat Send path and the candidate server-owned creator edit path are distinct. A positive Node boundary test must not be misrepresented as a wired browser UI. Next gate: isolated UI harness for a new explicit server-owned continuation action and a negative bypass court around legacy local write calls; original frontend RED unchanged.


## 2026-11-21 physical-browser gate after 9f033696

Exact-head physical Chromium/Mongo 11/11 GREEN is an isolated transport/authority result, not evidence that CreatorWorkspace uses the adapter. Inspected pinned frontend 344d98ff:
- CreatorWorkspace.jsx handleMovieMessage (225-240) immediately adds messages to React state, records creator messages in process-local pending memory, and invokes identityRuntime.settleConversationMessage for mentor messages.
- MovieMentorStudioIdentityRuntime.js recordPendingCreatorMessage (433+) keeps a process-local map; settleConversationMessage (477+) uses shared local settlement authority and local memory, not the isolated authenticated HTTP edit adapter.
- The pinned real UI does not call continueWithDurableServerAuthority; its strict read-only protection remains in force.

Required implementation boundary before any application wiring: define a server-owned conversation-turn admission and settlement contract (not merely content-only state edits); bind JWT owner, project, operation ID, expected revision, canonical turn identity and immutable receipt; keep pending creator turns on unknown outcomes; retrieve server receipt on retry; reject stale/competing writer; avoid exposing Mongo/fence to browser. Preserve the existing mentor backend request/response semantics. Only then stage an isolated real-UI test of actual send/reload/recovery and independently certify the original RED.

This section is a contract-gap record, not a claim of application integration or a GREEN.
