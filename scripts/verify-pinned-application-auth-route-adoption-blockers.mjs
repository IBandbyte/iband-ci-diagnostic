// Source-exact adoption blockers at the pinned *real* frontend entrypoints.
// Green means the blockers are independently identified, NOT solved.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createApplicationOwnedStudioServices} from './isolated-application-owned-studio-service-composition.mjs';
const app=readFileSync('./frontend/src/App.jsx','utf8');
const main=readFileSync('./frontend/src/main.jsx','utf8');
const auth=readFileSync('./frontend/src/components/studio/mentor/MovieMentorCreatorAuthenticationTransport.js','utf8');
const regression=readFileSync('./frontend/scripts/verify-movie-mentor-conversation-continuity.mjs','utf8');
const workspace=readFileSync('./frontend/src/components/studio/CreatorWorkspace.jsx','utf8');
assert.match(main,/MovieMentorCreatorAuthenticationBridge/);
assert.match(main,/<ClerkProvider/);
assert.match(auth,/async function resolveMovieMentorCreatorAuthToken/);
assert.match(auth,/async function resolveMovieMentorCreatorAuthToken[\s\S]*?await authState\.getToken\(\)/);
assert.match(auth,/function getMovieMentorCreatorAuthToken\(\) \{ return resolveMovieMentorCreatorAuthToken/);
assert.match(app,/path="\/studio"/);
assert.match(app,/element=\{<CreatorWorkspace onGenerate=\{generateMovieMentorLiveResponse\} \/>\}/);
assert.doesNotMatch(app,/applicationSecondFilm=|studioServices=|studioRecoveryServices=/);
assert.match(regression,/assert\.equal\(cleared\.acquired, true\)/);
console.log('GREEN PINNED_REAL_STUDIO_ROUTE_UNADOPTED_EXACT_SOURCE');
console.log('GREEN PINNED_CLERK_TOKEN_PROVIDER_ASYNCHRONOUS_CONTRACT');

let called=0;
const service=createApplicationOwnedStudioServices({
 transport:()=>{called++;return {ok:false}},
 getToken:()=>Promise.resolve('signed-clerk-token'),
 selectionVaultId:'vault',
 readLocalBytes:()=> 'original-bytes'
});
assert.throws(()=>service.recoveryServices(),/owner-token-unavailable/);
assert.throws(
 ()=>service.studioServices.request('/studio/selection-read',{projectId:'vault'}),
 /owner-token-unavailable/);
assert.equal(called,0,'a promise must never be sent as an Authorization bearer header');
assert.equal(readFileSync('./frontend/src/App.jsx','utf8'),app);
assert.equal(readFileSync('./frontend/src/main.jsx','utf8'),main);
assert.equal(readFileSync('./frontend/src/components/studio/CreatorWorkspace.jsx','utf8'),workspace);
assert.equal(readFileSync('./frontend/scripts/verify-movie-mentor-conversation-continuity.mjs','utf8'),regression);
console.log('GREEN ASYNC_AUTH_PROVIDER_FAILS_CLOSED_BEFORE_HTTP');
console.log('HELD ASYNC_AUTH_ADAPTER_ROUTE_COMPOSITION_AND_ORIGINAL_LINE_71_RED');
