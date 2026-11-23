// Independent source-anchored adoption readiness court.
// This is NOT application adoption or a resolution of the original line-71 RED.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {transformPinnedApplicationOwnedSecondFilmRecovery} from './isolated-pinned-application-owned-second-film-react-bridge.mjs';
import {transformPinnedApplicationOwnedConversationHandler} from './isolated-pinned-application-owned-conversation-bridge.mjs';
import {transformPinnedFencedConversationHandler} from './isolated-pinned-fenced-conversation-handler-candidate.mjs';
import {sourceHandler} from './isolated-studio-real-handler-adoption-candidate.mjs';

const file='./frontend/src/components/studio/CreatorWorkspace.jsx';
const regressionFile='./frontend/scripts/verify-movie-mentor-conversation-continuity.mjs';
const memoryFile='./frontend/src/components/studio/mentor/CreatorMemory.js';
const original=readFileSync(file,'utf8');
const regression=readFileSync(regressionFile,'utf8');
const memory=readFileSync(memoryFile,'utf8');
const expected='assert.equal(cleared.acquired, true);';
assert.equal(regression.split(expected).length,2,'original line-71 caller drift');
assert.match(regression,/memoryB\.replaceStateWithSharedAuthority\(/);
assert.match(memory,/publication-outbox-provenance-unverified/);
const old=spawnSync(process.execPath,[regressionFile],{encoding:'utf8'});
assert.equal(old.status,1,'original RED disappeared: not certified to adopt');
assert.match(old.stderr,/verify-movie-mentor-conversation-continuity\.mjs:71/);
assert.match(old.stderr,/false !== true/);
console.log('GREEN ORIGINAL_LINE_71_RED_REPRODUCED_UNMODIFIED');

const candidate=transformPinnedApplicationOwnedConversationHandler(
 transformPinnedFencedConversationHandler(
 transformPinnedApplicationOwnedSecondFilmRecovery(original)));
const native=candidate.match(sourceHandler)?.[0];
assert.ok(native);
assert.equal(candidate.split('const CreatorWorkspace = ({ applicationSecondFilm, studioServices,').length,2);
assert.equal(candidate.split('applicationSecondFilm.choose({').length,2);
assert.equal(candidate.split('applicationSecondFilm.reopen({').length,2);
assert.equal(candidate.split('applicationSecondFilm.requestEditing({').length,2);
assert.doesNotMatch(native,/globalThis\.__|recordPendingCreatorMessage|settleConversationMessage/);
assert.match(native,/studioServices\.editable/);
assert.match(native,/studioServices\.selection/);
assert.match(native,/studioServices\.request/);
assert.match(native,/The server result is unconfirmed/);
assert.match(candidate,/Recover movie preview/);
assert.match(candidate,/Recover server-authorised film/);
assert.equal(readFileSync(file,'utf8'),original);
assert.equal(readFileSync(regressionFile,'utf8'),regression);
assert.equal(readFileSync(memoryFile,'utf8'),memory);
console.log('GREEN SOURCE_ANCHORED_APPLICATION_OWNED_COMPONENT_AND_CONVERSATION_CANDIDATE');

// Do not confuse absence of diagnostic dependencies *inside the native
// conversation callback* with fully application-owned transport. The
// recovery candidate still contains harness globals, and real application
// composition, token acquisition and authority persistence remain unadopted.
assert.match(candidate,/globalThis\.__continuity/);
assert.match(candidate,/globalThis\.__diagnosticToken/);
assert.match(candidate,/globalThis\.__applicationSecondFilmPhysicalCalls/);
console.log('HELD RECOVERY_HARNESS_GLOBALS_AND_REAL_APP_SERVICE_COMPOSITION');
console.log('HELD ORIGINAL_FRONTEND_LINE_71_RED_AND_APPLICATION_ADOPTION');
