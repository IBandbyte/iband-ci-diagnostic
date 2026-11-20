# Safe Editable Restoration — Verifier-First Design

**Status:** design only; no new physical CI verdict. Phase 01 HELD; original frontend continuity RED preserved.

## Problem observed at pinned frontend 344d98ff
- `CreatorMemory.js` `continueWithDurableServerAuthority` (lines 771–789) validates server commit/readback through `MovieMentorDurableCreatorWriteBoundary.js` and returns `restorationMode: "server-read-only"`, `localStateAdopted: false`. This is intentional.
- `replaceStateWithSharedAuthority` (lines 480–585) checks persisted publication-outbox structure and rejects an outbox without matching live writer witness (`MOVIE_MENTOR_PUBLICATION_OUTBOX_PROVENANCE_UNVERIFIED`). A digest is not proof of origin.
- Therefore the real positive path from durable server authority to safe editable local state is **not** yet established. Do not forge `witnessedPublicationHistory`, remove this guard, or treat a server receipt as local publication permission.

## Authority question
Which server-signed, owner-scoped, revision-fenced and independently durable record can certify the publication-outbox provenance *and* authorize a new writer session to adopt an editable snapshot, while preventing stale writers and duplicate publication? The answer must come from a physical verifier and an explicit trusted protocol, not a browser flag.

## Proposed physical court (not yet implemented)
1. Isolated Mongo replica set; RS256 signed authenticated sessions; original CreatorMemory facade loaded from exact pinned frontend commit. Three independent Node processes, not a single-process mock.
2. Process A: owner commits creator state + publication intent through a trusted authority operation. Persist a server-owned provenance record with project, owner, revision, operation ID, outbox IDs/digests and authoritative commit ID; never accept client assertions of provenance.
3. Kill/restart A. Process B: same authenticated owner obtains a fresh server-owned, revision-fenced adoption grant; reads committed state; safely adopts editable state only after validating grant and publication provenance against durable authority. Test that adoption is a distinct operation from read-only continuation.
4. Process C: stale writer, unauthorized owner, revoked session and mismatched project/operation/revision/outbox attempts must all fail closed without modifying durable state or publishing anything.
5. Replay the same operation ID after socket loss/restart: exactly-once server effects, no duplicated publication intents; unknown outcomes reconcile by operation ID.
6. Assert local persistence is not written on any denial; no fabricated local witness; no application publication until a separate physically verified outbox consumer gate.
7. Re-run the original frontend continuity acceptance court **unchanged** on exact candidate head. Only its own physical pass can retire the original RED.

## Initial negative controls
- Valid server readback alone cannot authorize editable adoption.
- Client-supplied `authenticatedPrincipal`, `witnessedPublicationHistory` or forged digest cannot authorize.
- Different owner or revoked session denied.
- Stale expected revision denied; concurrent contenders cannot both win.
- Missing/mismatched publication provenance denied.
- Receipt/readback disagreement denied.
- Restart after commit but before receipt must reconcile; no blind new operation ID.

## Acceptance evidence
Record pinned frontend/backend/diagnostic SHAs, test script paths, workflow run/job links, each positive/negative assertion and original acceptance RED outcome. GREEN is scoped per court. No application main, production DB write, deployment or merge.

## Next implementation step
Implement the **negative-only provenance/adoption court first** on the isolated diagnostic branch. It should fail if any caller claims writable local adoption from read-only server continuation. Then design the server-owned adoption credential and physical positive restart court without weakening existing safeguards.
