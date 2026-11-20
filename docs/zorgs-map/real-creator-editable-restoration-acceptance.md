# Real Creator Memory editable-restoration acceptance contract

Status: DESIGN / NOT CERTIFIED. Diagnostic branch only. Real frontend pinned at `344d98ff0c7e075a7e6530c8871670ad8044d220`.

## Verified foundation
- Physical server-owned positive edit, fresh-process idempotent replay, intruder and stale-revision denial GREEN.
- Two independent edit contenders: one committed and one denied GREEN.
- Pinned real CreatorMemory facade with isolated server edit bridge: server admission, edit, fresh-process replay and intruder/forged-fence denial GREEN.
- **Original frontend RED and local writable adoption remain HELD.**

## Boundary
The real `continueWithDurableServerAuthority` returns `restorationMode: "server-read-only"` and `localStateAdopted: false`. Do not turn that response into a local publication witness. The strict facade's ordinary synchronous write path remains denied. The existing isolated bridge operates alongside the real facade; it is not an actual application UI integration.

## Next implementation gates
1. Introduce an explicit application-facing server-owned edit adapter, separate from local `replaceState`, with authenticated owner, project, fence, operation ID, expected revision, and canonical state returned by server.
2. Implement creator continuation from an authenticated canonical server readback, with server-owned editing capability rather than permission to persist the canonical outbox in local storage.
3. Verify full journey: first process save/edit, terminate process, fresh frontend facade instance, server readback, subsequent *new* edit at the next revision, restart, and exactly-once replay of both operation receipts. Reject stale, forged-fence, intruder, and revoked ownership attempts.
4. Verify two independent frontend sessions with competing edits, ensuring one winner and no local write bypass. Assert canonical publication history, project continuity, and no duplicate settlement.
5. Run the original frontend RED court on the exact candidate head. Do not promote Phase 01 until the original RED is genuinely resolved.

## Important gap to resolve before certifying
The isolated server editor currently demonstrates an initial edit and contention at the next revision; its replay semantics and admission continuity across multiple later edits must be tested explicitly. A previous receipt should not be mistaken for authorization to mutate a newer canonical state. A positive two-edit fresh-restart court is mandatory.

## Release constraints
VERIFIER FIRST. No borrowed GREEN. No production database writes, no merge, no deploy, and no application main changes.
