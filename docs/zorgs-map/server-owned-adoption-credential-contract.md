# Server-owned editable adoption credential — authority contract v0

Status: **design candidate only**; no physical positive-adoption verdict. Original frontend continuity RED preserved.

## Existing verified boundary
- Diagnostic exact head `efa6a3727beb23c225fd20129071c4adfe52c96b`, physical Mongo run 44737726380 / job 136293242148: valid durable receipt and replay remain read-only; forged outbox, intruder and stale revision denied.
- Pinned frontend `344d98ff0c7e075a7e6530c8871670ad8044d220`: `CreatorMemory.js` read-only continuation does not adopt local state or witness publication. `replaceStateWithSharedAuthority` rejects unwitnessed persisted outbox.
- Isolated Mongo authority adapter `scripts/isolated-mongo-creator-authority-adapter.mjs` has durable states and operation records, RS256 JWT owner check, revision compare-and-set and server-owned outbox equality; **it has no adoption-grant issuance or consumption method**.

## Proposed trusted protocol
1. **Issue** a grant exclusively on the server after verifying signed session, current project ownership, non-revocation, current revision and independently durable provenance of the exact publication-outbox contents. Do not derive provenance from a client digest alone.
2. Bind grant to `projectId`, `ownerId`, `ownershipRevision`, `committedRevision`, `serverCommitId`, `stateDigest`, `outboxDigest`, `grantId`, `expiresAt` and `purpose: editable-adoption`. Store its server-side record durably. A server signature is authentication of the grant, **not** a replacement for server-side replay/ownership checks.
3. **Consume** under Mongo transaction: revalidate authenticated owner, grant status, expiry, current revision and outbox provenance; atomically mark grant consumed / establish exclusive writer lease. Concurrency: at most one winning adopter per fenced revision. The grant cannot authorize publication.
4. **Readback** authoritative state, provenance and writer lease after consumption. The browser must not manufacture a local witness; editable local adoption needs a separate explicit trusted path whose semantics are proved by the original acceptance court.
5. **Restart**: new process/session requests its own grant, not a copied local boolean. A stale grant fails after ownership transfer, revocation or revision change.
6. **Unknown outcome**: reconcile by stable grant ID and operation ID after socket loss. Do not blindly issue a fresh grant or assume a failed transaction.

## Physical tests to implement before application wiring
- Isolated replica-set Mongo, RS256 owner/intruder, two simultaneous contenders plus fresh restart process.
- Positive grant issuance only for server-provenanced snapshot; one winner consumes, other denied; receipt/readback stable.
- Denials: unsigned/forged grant, different project/owner, revoked session, ownershipRevision changed, stale state revision, mismatched outbox, expired grant, replay, conflicting simultaneous consumers.
- Verify no change to publication outbox and no publish side effect; no local write on denied adoption.
- Unchanged original frontend continuity acceptance test must pass before original RED is retired.

## Critical unresolved design decision
The current isolated authority adapter rejects client outbox mutation but does not yet record a separate server-provenanced publication ledger or certify that a recovered outbox was genuinely issued by the server. **Do not issue positive adoption grants for nonempty outboxes until this ledger is physically verified.** An empty-outbox-only positive court may prove grant fencing but cannot certify publication provenance.

## Safety and certification
Implement on isolated diagnostic branch only; no main changes, production writes, deploy or merge. Each test must produce its own exact-head CI evidence. No inferred GREEN for editable restoration or publication.
