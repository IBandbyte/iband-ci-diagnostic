import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createAsyncAuthenticatedStudioSession} from './isolated-application-studio-async-clerk-session-adapter.mjs';

const appSource=readFileSync('./frontend/src/App.jsx','utf8');
const workspace=readFileSync('./frontend/src/components/studio/CreatorWorkspace.jsx','utf8');
const regression=readFileSync('./frontend/scripts/verify-movie-mentor-conversation-continuity.mjs','utf8');
const authSource=readFileSync('./frontend/src/components/studio/mentor/MovieMentorCreatorAuthenticationTransport.js','utf8');
assert.match(regression,/assert\.equal\(cleared\.acquired, true\)/);
assert.match(authSource,/async function resolveMovieMentorCreatorAuthToken/);
assert.throws(()=>createAsyncAuthenticatedStudioSession(),/async-authenticated-studio-dependencies-required/);
let token='clerk-signed-owner',authCalls=0,networkCalls=0,bytes='original-film-a';
const sent=[];
const session=createAsyncAuthenticatedStudioSession({
 getAuthToken:async()=>{authCalls++;return token;},
 transport:async ({path,token,body})=>{
  networkCalls++;sent.push({path,token,body});
  return {ok:true,projectId:body.projectId,activeProjectId:'film-a',revision:1};
 },
 selectionVaultId:'vault',readLocalBytes:()=>bytes
});
assert.equal(session.getServices(),null);
const started=await session.open();
assert.equal(started.ok,true);
assert.equal(typeof started.services.recoveryServices().token,'string');
assert.equal(authCalls,1);
const loaded=await started.services.studioServices.selection.load({
 token:'clerk-signed-owner',projectId:'vault'
});
assert.equal(loaded.ok,true);
assert.equal(authCalls,3);
assert.equal(networkCalls,1);
assert.equal(sent[0].token,'clerk-signed-owner');
assert.equal(bytes,'original-film-a');
console.log('GREEN ASYNC_CLERK_SESSION_RESOLVED_BEFORE_COMPOSED_SERVER_READ');

token='clerk-signed-owner-rotated';
await assert.rejects(()=>started.services.studioServices.request('/studio/read',{projectId:'film-b'}),
 /authenticated-session-rotated/);
assert.equal(networkCalls,1);
assert.equal(session.getServices(),null);
assert.equal(started.services.getContinuity(),null);
assert.throws(()=>started.services.recoveryServices(),/owner-token-unavailable/);
console.log('GREEN ASYNC_CLERK_TOKEN_ROTATION_INVALIDATES_SESSION_BEFORE_HTTP');

const newSession=await session.open();
assert.equal(newSession.ok,true);
await newSession.services.studioServices.request('/studio/read',{projectId:'film-b'});
assert.equal(networkCalls,2);
assert.equal(sent[1].token,'clerk-signed-owner-rotated');
assert.equal(newSession.services.studioServices.pending,null);
newSession.services.studioServices.pending={creator:{id:'pending-unconfirmed'}};
assert.equal(newSession.services.studioServices.pending.creator.id,'pending-unconfirmed');
session.invalidate();
assert.equal(session.getServices(),null);
assert.equal(newSession.services.studioServices.pending,null);
assert.throws(()=>newSession.services.studioServices.request('/studio/read',{projectId:'film-b'}),
 /owner-token-unavailable|stale-authenticated-studio-session/);
assert.equal(networkCalls,2);
console.log('GREEN ASYNC_CLERK_REAUTH_RECOMPOSES_AND_EXPLICIT_INVALIDATION_DENIES_STALE_WRITES');

token='';
const missing=await session.open();
assert.deepEqual(missing,{ok:false,reason:'authenticated-token-unavailable'});
assert.equal(session.getServices(),null);
assert.equal(networkCalls,2);
token='clerk-signed-owner';
let release;
const delayed=new Promise(resolve=>release=resolve);
const race=createAsyncAuthenticatedStudioSession({
 getAuthToken:()=>delayed,transport:async()=>{throw Error('stale-should-never-transport')},
 selectionVaultId:'vault',readLocalBytes:()=>bytes
});
const inFlight=race.open();
race.invalidate();
release('clerk-signed-owner');
assert.deepEqual(await inFlight,{ok:false,reason:'stale-authentication'});
assert.equal(race.getServices(),null);
console.log('GREEN ASYNC_CLERK_MISSING_AND_STALE_INFLIGHT_TOKEN_DENIED');

// Deferred response must not escape an obsolete session or invalidate its successor.
let currentToken='owner-old',releaseResponse,entered;
const enteredPromise=new Promise(r=>entered=r);
const responsePromise=new Promise(r=>releaseResponse=r);
const delayedSession=createAsyncAuthenticatedStudioSession({
 getAuthToken:async()=>currentToken,selectionVaultId:'vault',readLocalBytes:()=>bytes,
 transport:async({token})=>{if(token==='owner-old'){entered();return responsePromise;}return {ok:true,token};}
});
const oldSession=await delayedSession.open();
const pending=oldSession.services.studioServices.request('/studio/read',{projectId:'film-b'});
const denied=assert.rejects(pending,/stale-authenticated-studio-session/);
await enteredPromise;
currentToken='owner-new';
const successor=await delayedSession.open();
assert.equal(successor.ok,true);
releaseResponse({ok:true,obsolete:true});
await denied;
assert.equal(delayedSession.getServices(),successor.services);
assert.deepEqual(await successor.services.studioServices.request('/studio/read',{projectId:'film-b'}),{ok:true,token:'owner-new'});
console.log('GREEN ASYNC_CLERK_DELAYED_RESPONSE_DENIED_WITH_SUCCESSOR_PRESERVED');

let rotateToken='before',releaseRotated,enteredRotated;
const rotatedEntered=new Promise(r=>enteredRotated=r);
const rotatedResponse=new Promise(r=>releaseRotated=r);
const rotating=createAsyncAuthenticatedStudioSession({
 getAuthToken:async()=>rotateToken,selectionVaultId:'vault',readLocalBytes:()=>bytes,
 transport:async()=>{enteredRotated();return rotatedResponse;}
});
const before=await rotating.open();
const rotatingRequest=before.services.studioServices.request('/studio/read',{projectId:'film-b'});
const rotationDenied=assert.rejects(rotatingRequest,/authenticated-session-rotated/);
await rotatedEntered;
rotateToken='after';releaseRotated({ok:true});
await rotationDenied;
assert.equal(rotating.getServices(),null);
assert.throws(()=>before.services.recoveryServices(),/owner-token-unavailable/);
console.log('GREEN ASYNC_CLERK_ROTATION_DURING_HTTP_RESPONSE_DENIED');

assert.equal(readFileSync('./frontend/src/App.jsx','utf8'),appSource);
assert.equal(readFileSync('./frontend/src/components/studio/CreatorWorkspace.jsx','utf8'),workspace);
assert.equal(readFileSync('./frontend/scripts/verify-movie-mentor-conversation-continuity.mjs','utf8'),regression);
console.log('GREEN ORIGINAL_STUDIO_ROUTE_AND_FRONTEND_RED_UNMODIFIED');
console.log('HELD REAL_STUDIO_ROUTE_ADOPTION_AND_PHYSICAL_ASYNC_AUTH_COMPOSITION');
