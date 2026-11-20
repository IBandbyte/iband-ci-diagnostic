# ZORG'S MAP 🗺️ — Zonal Overview & Reliability Graph

Status: engineering navigation specification, **not** an application feature or production deployment.
Owner protocol: VERIFIER FIRST. Phase 01 HELD. Main branches untouched. No production DB writes, deployments or merges.

## Purpose
An expandable, layered Movie Mentor engineering map for the Captain and engineering assistant. It must show what exists, what connects, what is physically verified, what remains RED, and which evidence supports each conclusion. This document is a durable handoff anchor, not a claim that an interactive dashboard is already implemented.

## Navigation
- Level 0: master architecture / creator journey.
- Level 1: frontend, backend, database, authentication/authority, Creator Memory, images, video, audio, verification.
- Level 2: subsystems and workflows; click to expand.
- Level 3: components, folders, APIs, storage boundaries and dependency connections.
- Level 4: individual functions, tests, exact-head run URLs, assertions and repair checkpoints.
- Both **tree view** (ownership/hierarchy) and **subway view** (data-flow/dependencies) use the same register.
- A connection is its own independently evaluated edge; two GREEN endpoints do not make an edge GREEN.

## Colour semantics
- GREEN: exact-head evidence explicitly certifies the **specified scope**; include commit SHA, workflow/run, assertion and date.
- RED: original failing acceptance test or demonstrated failing/blocked requirement; retain until **its own** physical test passes.
- AMBER: implementation or verification in progress, no certified positive outcome yet.
- BLUE: required connection not yet independently certified.
- PURPLE: future roadmap, outside the current phase.
- GREY: unexamined or insufficient evidence; never equate with failure or success.
- Parent status is derived conservatively: any required RED is visible on all ancestors; unknown and incomplete children prevent blanket GREEN. Avoid ungrounded percent-complete claims.

## Evidence register record shape
Each node and edge should have stable ID, parent IDs, type (node/edge), human title, actual repository path or service, phase, current status, status rationale, exact commit SHA, CI workflow/run/job URL, evidence assertion, last verification date, unresolved original RED reference, dependency IDs, next action, and last update. Unknown values stay null.

## Current verified anchors (2026-11-20)
- Frontend candidate `344d98ff0c7e075a7e6530c8871670ad8044d220`: isolated read-only server-continuation contract GREEN, run https://github.com/IBandbyte/Iband-frontend-first/actions/runs/44731427676 . This **does not** certify editable local adoption.
- Diagnostic `590aabcab8e7d7ebc3f6a0069628209aa9d9b4be`: pinned frontend 344d98ff, physical three-process real CreatorMemory facade + Mongo authenticated commit/replay/denial GREEN, run https://github.com/IBandbyte/iband-ci-diagnostic/actions/runs/44731517564 .
- Same diagnostic head: authority-denial workflow GREEN, run https://github.com/IBandbyte/iband-ci-diagnostic/actions/runs/44731517544 .
- **Original frontend conversation-continuity RED remains unresolved**. Local editable adoption and publication-outbox provenance after restart remain HELD. No borrowed GREEN.
- Backend pinned source for the isolated diagnostic `f367cd1964bac89b7ba23f1a662c0df19c3b8d16`. These isolated checks do not certify production deployment or all backend modules.
- Images, video and audio are proposed navigation branches; their internal node/edge statuses require separate audit. Future voice/accent profiles and visual continuity are future scope, not Phase 01 GREEN.

## Daily closing ritual
1. Check latest exact-head workflow results and physical logs for each changed candidate.
2. Update only nodes and edges supported by that evidence; preserve prior evidence and all original REDs.
3. Record the exact SHA and CI URL for each change, plus the next gate.
4. Regenerate the master visual and changed submaps from the same evidence register.
5. Save a dated checkpoint and a concise handoff. If no verified change occurred, record no status change.
6. Never claim an automatic daily update unless a real scheduled workflow has been configured.

## First engineering task
Build a machine-readable node/edge register and a read-only clickable prototype on the diagnostic branch. Start with the Creator Memory recovery path, including frontend facade, signed ownership, Mongo durable operation, fresh-process replay, local read-only projection and **RED editable restoration**. Then audit the actual repository imports/routes and expand the map; do not invent connections.
