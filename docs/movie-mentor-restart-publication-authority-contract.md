# Movie Mentor — restart publication authority contract (proposal, NOT certified)

Status: DESIGN ONLY. Verifier first. Phase 01 HELD. No production use.

## Observed facts
- Frontend CreatorMemory.replaceStateWithSharedAuthority rejects persisted outbox history when a new facade lacks a process-local witness; this must remain fail-closed.
- Frontend outbox snapshotDigest is a non-cryptographic equality marker, not authentication.
- Backend MovieMentorCreatorStateMutationAuthority requires freshly authenticated project ownership, expected revision, next revision, creator-state generation and fingerprint.
- Backend Mongo atomic acceptance checks ownership again within the transaction, fences ownership, checks revision, and records operation idempotency.
- Existing backend creator-state fields do not attest to the frontend publication outbox. The two authority domains are NOT interchangeable.

## Proposed server-side durable publication checkpoint
Per (principalId, projectId), in an independently trusted backend store:
- publicationRevision: monotonic integer
- canonicalStateDigest: cryptographic digest of canonical creator memory payload and publication outbox; never accept a client-supplied digest without server-side verification of the actual payload
- outboxHead: digest/sequence of the canonical accepted publication history
- ownershipRef and ownershipRevision: bound to currently authenticated project owner
- operationId and requestDigest: replay identity, uniquely constrained by project and principal
- acceptedAt and authoritative state reference, with the full canonical state retrievable or verifiably matched

The server must derive and persist the canonical digest and publication checkpoint atomically with the accepted operation. Merely signing or echoing a digest supplied by the browser does NOT make forged local bytes trustworthy.

## Restart admission
1. Authenticate the current user and verify current ownership of the exact project.
2. Fetch trusted canonical state and publication checkpoint from the server; never use local storage as authority.
3. Compare local state to canonical server state. A mismatch is quarantined; do not silently rebase or publish.
4. Issue a short-lived, single-operation, project-bound mutation admission for the exact expected revision and proposed state; admission cannot be used as an offline reusable token.
5. Commit through backend transaction with a fresh ownership check, atomic revision CAS, publication checkpoint update and operation-id idempotency.
6. Only after server acceptance may the client adopt the canonical committed snapshot and continue; uncertain network outcomes must be resolved by operation-id replay, not a second blind write.

## Required independent courts (all exact-head)
- Valid owner + matching server checkpoint + fresh process: positive next-scene write, server restart, then durable replay and second restart.
- Forged local state, forged outbox, forged digest, mismatched canonical checkpoint: deny, preserve server bytes.
- Wrong principal/project, revoked ownership and changed ownership revision: deny.
- Stale expected revision, simultaneous writers, reused operationId with different requestDigest: deny; no duplicate publication.
- Lost response after committed transaction: idempotent replay yields same result, exactly one publication.
- Server unavailable, missing canonical checkpoint, ambiguous historical local-only outbox: fail closed; do not auto-promote.
- Crash at every boundary (before commit, after commit before response, after response before local adoption): recover by authoritative read/replay without clobber.
- Original conversation-continuity regression remains RED until positive end-to-end real CreatorMemory integration passes.

## Non-goals / prohibitions
- No trusting browser localStorage, structural hashes, or process-local witnesses after restart.
- No treating backend creator-state mutation authority as publication-outbox authority without an explicit, physically tested integration.
- No bypass of existing CreatorMemory provenance guard, no forced GREEN, no production DB writes, no deploy, no merge, no application main changes.

Implementation remains outstanding. This proposal does not certify any positive restart-authorisation path.
