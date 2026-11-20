# Real frontend creator continuation — isolated integration gate

Status: DESIGN / NOT CERTIFIED. Diagnostic branch only. No application-main edits.

## Evidence and pinned boundaries
- Adapter physical court at exact head `f0671598f3602eeeac4d9d9a7272c5b018c92343`, run `44819904886`, job `136577791966`: six GREEN lines including authenticated intruder/forged-fence read-and-edit denial and two-facade contention.
- Frontend pinned at `344d98ff0c7e075a7e6530c8871670ad8044d220`, `src/components/studio/mentor/CreatorMemory.js`.
- Real facade `continueWithDurableServerAuthority` delegates to `MovieMentorDurableCreatorWriteBoundary.js`, returns a server-read-only snapshot, and does not adopt canonical bytes into local persistence. `replaceStateWithSharedAuthority` remains a distinct local writer and must not be used as a server-owned edit adapter.
- The isolated adapter currently calls server-owned Mongo components directly inside a Node verifier; this is NOT a browser-safe transport or real UI integration.

## Safe candidate architecture (isolated only)
1. Define an authenticated HTTP API/transport contract for canonical readback and server-owned edit, with owner JWT, project, admission operation, fence, operation ID and expected revision. The server independently authenticates the owner and validates current ownership, revocation, admission, publication provenance, and transactional CAS; never trust the browser's fence or snapshot alone.
2. Introduce a browser-safe client adapter at the actual creator continuation call site; it may display canonical state and submit new edits, but must not call local `replaceState`, `replaceStateWithSharedAuthority`, or invent a process-local publication witness.
3. On a new session: authenticate, read canonical project state, render the server-owned continuation, submit a new revision-fenced edit, terminate, reopen, read canonical state, replay both receipts, and prove no duplicate publication or ledger mutation.
4. Two independent browser sessions compete at the same expected revision: exactly one server commit, one denial; both must subsequently observe the winning canonical state.
5. Intruder, invalid signature, forged fence, stale revision, revoked owner and ownership transfer must deny reads and writes. A revoked owner cannot replay old receipts to obtain new authority.
6. Run the ORIGINAL frontend RED court unchanged on the exact candidate head, alongside the positive court. No borrowed verdicts or replacing the original test with a narrower surrogate.

## Release blockers
- No actual frontend UI call-site integration is implemented or certified.
- No authenticated browser-to-server transport is implemented or certified.
- No original frontend RED resolution has been observed.
- Local writable restoration is HELD; Phase 01 HELD.

VERIFIER FIRST. Main branches untouched. No production write, deploy or merge.
