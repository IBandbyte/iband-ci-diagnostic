# Actual Creator Memory continuation API compatibility court

Status: IMPLEMENTATION DESIGN / NOT CERTIFIED. Isolated diagnostic branch; real frontend pinned at `344d98ff0c7e075a7e6530c8871670ad8044d220`.

## Exact source inspection
`src/components/studio/mentor/MovieMentorDurableCreatorWriteBoundary.js` exports `continueCreatorMemoryWithDurableAuthority`. It requires `projectId`, `operationId`, `expectedRevision`, `authenticatedSession`, `proposedState`, and a trusted `authorityAdapter` exposing `commit` and `readCommitted`. It requires a commit receipt with `status:'committed'`, matching project and operation, `committedRevision`, and nonempty `serverCommitId`. It then calls `readCommitted` and requires identical receipt identity, revision, and `state` equal to `proposedState`. It treats exceptions as `durable-outcome-unknown`.

The isolated `createServerOwnedCreatorEditingAdapter` instead exposes `read()` and `edit({operationId,expectedRevision,content})`. Its edit returns canonical server state and revision. It is a Node-side Mongo adapter, not a browser transport. **These contracts are not interchangeable**; plugging one into the other directly cannot establish real frontend integration.

## Required compatibility adapter, diagnostic only
- Implement a server-side transport handler whose authenticated principal is derived from verified session/JWT; reject browser-supplied principal claims. Translate `proposedState` into an explicitly validated canonical edit operation; do not treat an arbitrary whole-state object as trusted.
- Map canonical edit receipt to the exact frontend `commit` response, with stable `serverCommitId` derived from durable operation receipt, not a fresh random value on replay.
- Implement `readCommitted` by authenticated operation ID with a durable receipt and canonical state. For historical replay after newer edits, distinguish the immutable *operation-specific committed state* from latest canonical readback; do not return latest state under an old receipt if the frontend expects equality with old `proposedState`.
- On timeout/unknown outcome, reconcile by the SAME operation ID; never mint a new operation ID.
- Keep read-only reopening separate from the mutation-only `continueCreatorMemoryWithDurableAuthority` boundary. No local witness promotion, local whole-state writes, or frontend main modifications.
- Require independent physical test of the **actual pinned boundary**, including receipt/readback mismatch denial, replay after later revision, intruder, revoked ownership, competing edits, and fresh-process restart. Original frontend RED stays preserved until run unchanged.

## Critical acceptance warning
A 6/6 GREEN isolated editing adapter is not a GREEN for the real `commit/readCommitted` frontend contract. No integration claim until this mismatch is resolved and physically verified.

VERIFIER FIRST. Phase 01 HELD. Application main untouched. No production write, deploy, or merge.

## Physical compatibility certification — 2026-11-20
- Exact head: `0039d7d39e94bd8f70de3a6dc9ab760762913f89`.
- GitHub Actions run: `44822445951`, job: `136586484961`.
- Five physical GREEN markers: server admission; first pinned-boundary edit; second pinned-boundary edit; fresh-process historical/current receipt readback; intruder/forged-fence denial.
- Job explicitly printed `HELD ORIGINAL_FRONTEND_RED_AND_REAL_UI_INTEGRATION`.
- This certifies the isolated compatibility court only, NOT browser transport, real UI integration, revoked-ownership denial, or the original frontend RED.

## Revoked ownership physical certification — 2026-11-20
- Exact head `754c06d53fd329a165a7cb2019de73845740b9d9`; run `44823455159`, job `136589944274`.
- Six physical GREEN markers: admission, first edit, second edit, historical/current readback, intruder/forged denial, revoked owner historical/current read/replay/edit denial.
- Revocation assertions require no revision advance or extra edit receipt after denial.
- The job explicitly reports `HELD ORIGINAL_FRONTEND_RED_AND_REAL_UI_INTEGRATION`; no browser transport or actual UI integration certified.
