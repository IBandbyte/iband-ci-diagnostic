import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformPinnedStudioRouteToAuthorityShell} from './isolated-pinned-studio-route-authority-candidate.mjs';
import {createStudioAuthorityRouteLifecycle} from './isolated-studio-authority-route-lifecycle.mjs';
const path='./frontend/src/App.jsx',orig=readFileSync(path,'utf8');
const main=readFileSync('./frontend/src/main.jsx','utf8');
const regression=readFileSync('./frontend/scripts/verify-movie-mentor-conversation-continuity.mjs','utf8');
assert.match(regression,/assert\.equal\(cleared\.acquired, true\)/);
assert.match(main,/<ClerkProvider/);
const candidate=transformPinnedStudioRouteToAuthorityShell(orig);
for(const route of ['/', '/artists', '/artists/:id', '/submit', '/studio']){
 assert.ok(candidate.includes('path="'+route+'"'),'pinned route lost: '+route);
}
assert.match(candidate,/StudioRouteAuthorityShell onGenerate=\{generateMovieMentorLiveResponse\}/);
assert.equal(readFileSync(path,'utf8'),orig);
console.log('GREEN PINNED_STUDIO_ROUTE_SOURCE_EXACT_CANDIDATE_OTHER_ROUTES_UNCHANGED');

let state={isLoaded:false,isSignedIn:false,getToken:null};
const listeners=new Set(),ready=[],denied=[],instances=[];
const notify=()=>{for(const fn of [...listeners])fn()};
const subscribeAuth=fn=>{listeners.add(fn);return ()=>listeners.delete(fn)};
const tokenA=async()=> 'valid-jwt-a';
const tokenB=async()=> 'valid-jwt-b';
let releaseFirst;
const firstPromise=new Promise(resolve=>releaseFirst=resolve);
const lifecycle=createStudioAuthorityRouteLifecycle({
 getAuthState:()=>state,subscribeAuth,
 createSession:({getAuthToken})=>{
   let invalidated=false;
   const id=instances.length;
   const app={id,readonly:true,writable:false};
   const session={
     getServices:()=>invalidated?null:app,
     invalidate:()=>{invalidated=true;session.invalidated=true},
     async open(){
       if(id===0)await firstPromise;
       const token=await getAuthToken();
       if(invalidated)return {ok:false,reason:'stale-auth'};
       return token?{ok:true,services:app}:{ok:false};
     }
   };
   instances.push(session);return session;
 },
 onReady:x=>ready.push(x),onDenied:x=>denied.push(x)
});
const stop=lifecycle.start();
assert.equal(listeners.size,1);
assert.equal(instances.length,0);
assert.equal(lifecycle.getCurrent(),null);
state={isLoaded:true,isSignedIn:true,getToken:tokenA};notify();
assert.equal(instances.length,1);
assert.equal(lifecycle.getCurrent(),null,'async unresolved auth must not be exposed as ready');
state={isLoaded:true,isSignedIn:true,getToken:tokenB};notify();
assert.equal(instances[0].invalidated,true);
assert.equal(instances.length,2);
await new Promise(resolve=>setImmediate(resolve));
assert.equal(ready.at(-1)?.id,1);
assert.equal(ready.at(-1)?.writable,false);
releaseFirst();
await new Promise(resolve=>setImmediate(resolve));
assert.equal(ready.at(-1)?.id,1,'stale first open must not republish authority');
console.log('GREEN STUDIO_ROUTE_STALE_ASYNC_AUTH_OPEN_FENCED');
state={isLoaded:true,isSignedIn:false,getToken:null};notify();
assert.equal(instances[1].invalidated,true);
assert.equal(lifecycle.getCurrent(),null);
assert.equal(ready.at(-1),null);
assert.equal(denied.at(-1),'creator-authentication-required');
console.log('GREEN STUDIO_ROUTE_SIGNOUT_CLEARS_SERVER_AUTHORITY');
state={isLoaded:true,isSignedIn:true,getToken:tokenA};notify();
await new Promise(resolve=>setImmediate(resolve));
assert.equal(instances.length,3);
assert.equal(ready.at(-1)?.id,2);
stop();
assert.equal(listeners.size,0);
assert.equal(instances[2].invalidated,true);
assert.equal(ready.at(-1),null);
notify();
assert.equal(instances.length,3,'unmounted route must not reauthenticate');
assert.equal(readFileSync(path,'utf8'),orig);
assert.equal(readFileSync('./frontend/scripts/verify-movie-mentor-conversation-continuity.mjs','utf8'),regression);
console.log('GREEN STUDIO_ROUTE_UNMOUNT_INVALIDATES_AND_UNSUBSCRIBES');
console.log('HELD ACTUAL_APP_ROUTE_INTEGRATION_AND_ORIGINAL_FRONTEND_LINE_71_RED');
