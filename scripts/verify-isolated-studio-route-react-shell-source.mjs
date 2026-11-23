// Source-exact route shell gate, not a physical React integration verdict.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformPinnedStudioRouteToAuthorityShell} from './isolated-pinned-studio-route-authority-candidate.mjs';
const originalApp=readFileSync('./frontend/src/App.jsx','utf8');
const originalWorkspace=readFileSync('./frontend/src/components/studio/CreatorWorkspace.jsx','utf8');
const originalRegression=readFileSync('./frontend/scripts/verify-movie-mentor-conversation-continuity.mjs','utf8');
const authBridge=readFileSync('./frontend/src/components/studio/mentor/MovieMentorCreatorAuthenticationTransport.js','utf8');
const shell=readFileSync('./scripts/isolated-studio-route-authority-react-shell.jsx','utf8');
assert.match(originalRegression,/assert\.equal\(cleared\.acquired, true\)/);
const appCandidate=transformPinnedStudioRouteToAuthorityShell(originalApp);
assert.match(appCandidate,/path="\/studio"/);
assert.match(appCandidate,/StudioRouteAuthorityShell onGenerate=\{generateMovieMentorLiveResponse\}/);
assert.match(shell,/getMovieMentorCreatorAuthState/);
assert.match(authBridge,/subscribeMovieMentorCreatorAuthState/);
assert.match(shell,/createStudioAuthorityRouteLifecycle/);
assert.match(shell,/typeof createSession!=='function'/);
assert.match(shell,/data-authority="denied"/);
assert.match(shell,/if\(!valid\)/);
assert.match(shell,/WorkspaceComponent/);
assert.match(shell,/studioRecoveryServices=\{services\.recoveryServices\(\)\}/);
assert.match(shell,/applicationSecondFilm=\{services\.applicationSecondFilm\}/);
assert.match(shell,/studioServices=\{services\.studioServices\}/);
assert.match(shell,/return \(\)=>\{mounted=false;stop\(\)\}/);
assert.equal(shell.includes('globalThis.__'),false);
assert.equal(shell.includes('replaceStateWithSharedAuthority'),false);
assert.equal(shell.includes('recordPendingCreatorMessage'),false);
// The current App candidate deliberately does not provide a production
// createSession factory; do not advertise it as adopted/live.
assert.equal(appCandidate.includes('createSession='),false);
assert.equal(readFileSync('./frontend/src/App.jsx','utf8'),originalApp);
assert.equal(readFileSync('./frontend/src/components/studio/CreatorWorkspace.jsx','utf8'),originalWorkspace);
assert.equal(readFileSync('./frontend/scripts/verify-movie-mentor-conversation-continuity.mjs','utf8'),originalRegression);
console.log('GREEN PINNED_REACT_STUDIO_ROUTE_SHELL_FAIL_CLOSED_SOURCE_CONTRACT');
console.log('GREEN ORIGINAL_FRONTEND_SOURCE_AND_LINE_71_ASSERTION_UNCHANGED');
console.log('HELD REAL_ROUTE_SESSION_FACTORY_AND_PHYSICAL_REACT_MOUNT_VERIFICATION');
