# Authenticated browser-to-server creator continuation: acceptance contract

Status: DESIGN ONLY / PHASE 01 HELD. This document is not a physical GREEN or authorization to wire production UI.

## Pinned source and verified baseline
- Pinned frontend `IBandbyte/Iband-frontend-first@344d98ff0c7e075a7e6530c8871670ad8044d220`: `src/components/studio/mentor/MovieMentorDurableCreatorWriteBoundary.js`.
- Diagnostic physical baseline `754c06d53fd329a165a7cb2019de73845740b9d9`, run 44823455159, job 136589944274: six GREEN including revocation.
- Current frontend continuation boundary accepts `authorityAdapter.commit` and `authorityAdapter.readCommitted` but has **no application caller**. The server-trusted adapter must not be shipped to a browser.
- `CreatorMemory.js` strict facade remains read-only and must not promote server receipts to local publication witnesses.

## Minimum transport design (not implemented)
1. Browser sends `Authorization: Bearer <Clerk JWT>` over same-origin authenticated HTTPS, with project ID, operation ID, expected revision and proposed content. Never send Mongo access, server fence or privileged adapter.
2. Server independently validates JWT signature, issuer, audience, expiry and project ownership on **every request**. Derive identity from verified JWT, not `authenticatedSession` or a client-supplied owner ID.
3. Server resolves admission and current active writer fence from durable storage; checks ownership revision and revocation at write time and readback time.
4. Server commits content-only mutation using durable revision CAS and immutable operation receipt. Same operation+same payload returns original receipt; mismatched payload or stale new operation is denied.
5. Browser receives `serverCommitId`, revision and project/operation identifiers, then separately reads back committed operation through an authenticated endpoint. Client must verify exact receipt/state equality before displaying a committed status.
6. Timeout or lost response is UNKNOWN; reconcile by the **same** operation ID after reload. Never mint a new ID for uncertain effects.
7. Browser continuation remains read-only until the real UI can demonstrate recovery without calling `replaceStateWithSharedAuthority`, forging publication history, or bypassing the shared-writer boundary.

## Required physical examinations
- Authenticated HTTP first edit; second edit; fresh browser process/reload historical and current readback.
- Two independent browser clients racing the same expected revision: exactly one new operation wins.
- Intruder, forged fence/owner, expired/invalid JWT and revoked owner denied on write **and readback**.
- Socket loss after durable commit, same-operation retry and no duplicate edit receipt.
- Tampered content or receipt denied; server identity never inferred from browser session object.
- Verify actual UI wiring and persisted recovery independently of this isolated adapter court.
- Re-run original frontend RED unchanged. Keep Phase 01 HELD until its own exact-head result is certified.

## Guardrails
No merge, deploy, application main changes or production database writes. Every court must run on isolated resources and report exact-head physical logs. Prior six GREEN markers are not transferable to the new HTTP/UI court.

## Isolated HTTP physical certification — 2026-11-20
- Exact head: `5b1a1b557aca517456212093b20120d7a6b2ceef`; GitHub Actions run `44826134644`, job `136599076720`.
- Six physical GREEN markers: server admission, first HTTP edit/readback, second HTTP edit/readback, fresh-process historical/latest replay, intruder/invalid JWT/tampered replay denial, revoked owner read/edit denial.
- The job explicitly prints `HELD ORIGINAL_FRONTEND_RED_AND_REAL_UI_INTEGRATION`.
- HTTP socket-loss recovery, concurrent HTTP writers, actual browser UI wiring and unchanged original frontend RED remain unverified. No production deployment or application main changes.

## Concurrent HTTP writers — physical certification (2026-11-20)
- Exact head `96d07bb311203172ed1049ba320c4c41493d8a78`; run `44827327877`; job `136603129269`.
- Seven GREEN markers including `HTTP_TWO_CONCURRENT_WRITERS_EXACTLY_ONE_WINNER`. Exactly one of two competing authenticated HTTP operations committed at expected revision 4; revision advanced to 5 with three total edit receipts.
- Original frontend RED and real UI integration remain HELD. Interrupted-connection outcome-unknown recovery is still unverified for HTTP.

## Socket-loss and fresh-process HTTP recovery — physical certification (2026-11-20)
- Exact head `23cee1626ef3e3ea0dc41064ba5065c17c354c88`; run `44828125819`, job `136605843435`: **nine physical GREEN markers**, including `HTTP_POST_COMMIT_SOCKET_LOSS_DURABLE_EFFECT` and `HTTP_FRESH_PROCESS_SAME_OPERATION_REPLAY_NO_DUPLICATE`.
- Separate earlier run `44828111185`, job `136605797724` is RED at revocation assertion; retain as historical failure, do not borrow a verdict from it.
- The nine GREEN certify isolated server HTTP behaviour, **not** real browser/UI integration, original frontend continuity, production readiness, or deployment.

## Pinned frontend boundary through browser-shaped HTTP — physical certification (2026-11-20)
- Exact head `3d3df34b5b8cca75f059a60035ba2adc9334ef8f`; run `44828941827`, job `136608610404`.
- Ten physical GREEN markers, including `PINNED_FRONTEND_BOUNDARY_BROWSER_HTTP_EDIT_AND_READBACK`. The pinned real frontend module executed through the isolated browser-shaped authenticated HTTP adapter and durable server readback; earlier HTTP courts also passed.
- This is a Node-based physical integration court of the real pinned module, **not** a browser UI call-site implementation or certification. Original frontend RED and real UI integration remain HELD. No merge, deploy, production DB write, or application main edit.
