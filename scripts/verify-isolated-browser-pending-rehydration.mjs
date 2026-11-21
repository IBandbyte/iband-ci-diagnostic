import assert from 'node:assert/strict';
import {createIsolatedBrowserPendingJournal} from './isolated-browser-pending-rehydration-journal.mjs';
const db=new Map();
const storage={getItem:k=>db.get(k)??null,setItem:(k,v)=>db.set(k,v),removeItem:k=>db.delete(k)};
const scene={id:'scene-two',text:'Confirmed next scene'};
const creator={id:'turn-1',role:'creator',text:'Create next scene'};
let mode='confirmed',calls=0;
const readCommitted=async ({projectId,operationId,authenticatedSession})=>{
 calls++;assert.equal(authenticatedSession,'owner-session');
 if(mode==='offline')throw Error('socket-loss');
 const good={ok:true,projectId,operationId,revision:2,serverCommitId:'server-'+operationId,state:{scenes:[{id:'scene-one',text:'Opening scene'},scene]}};
 if(mode==='missing')return {ok:false};
 if(mode==='other-owner')return {...good,ok:false};
 if(mode==='other-project')return {...good,projectId:'film-b'};
 if(mode==='other-operation')return {...good,operationId:'forged'};
 if(mode==='other-scene')return {...good,state:{scenes:[{id:'different',text:'different'}]}};
 if(mode==='bad-revision')return {...good,revision:0};
 return good;
};
const initial=createIsolatedBrowserPendingJournal({storage,readCommitted});
assert.equal(initial.stage('film-a',creator).ok,true);
assert.equal(initial.attach('film-a','turn-1',scene).ok,true);
assert.equal(initial.stage('film-a',creator).ok,false);
const before=JSON.stringify([...db.entries()]);
// New journal instance is a stand-in for a freshly restarted browser runtime,
// not a claim of physical Chromium-process survival.
const restarted=createIsolatedBrowserPendingJournal({storage,readCommitted});
assert.equal(restarted.inspect('film-a').creator.id,'turn-1');
assert.equal(restarted.inspect('film-b'),null);
assert.equal((await restarted.reconcile({projectId:'film-a'})).reason,'authentication-required');
assert.equal(JSON.stringify([...db.entries()]),before);
for(const name of ['offline','missing','other-owner','other-project','other-operation','other-scene','bad-revision']){
 mode=name;
 const result=await restarted.reconcile({projectId:'film-a',authenticatedSession:'owner-session'});
 assert.equal(result.ok,false,name);
 assert.equal(restarted.inspect('film-a').creator.id,'turn-1');
 assert.equal(JSON.stringify([...db.entries()]),before,name);
}
console.log('GREEN BROWSER_PENDING_REHYDRATION_RESTARTED_INSTANCE_DENIES_UNVERIFIED_REMOTE_AND_PRESERVES_BYTES');
mode='confirmed';
const result=await restarted.reconcile({projectId:'film-a',authenticatedSession:'owner-session'});
assert.equal(result.ok,true);
assert.equal(result.revision,2);
assert.equal(result.scene.id,'scene-two');
assert.equal(restarted.inspect('film-a'),null);
assert.equal(db.size,0);
assert.ok(calls>=8);
console.log('GREEN BROWSER_PENDING_REHYDRATION_AUTHENTICATED_RECEIPT_RETIRES_EXACT_TURN');
assert.equal((await restarted.reconcile({projectId:'film-a',authenticatedSession:'owner-session'})).reason,'no-valid-pending');
console.log('GREEN BROWSER_PENDING_REHYDRATION_NO_DUPLICATE_LOCAL_RETIREMENT');
console.log('HELD PHYSICAL_CHROMIUM_PERSISTENT_PROFILE_SIGKILL_AND_ORIGINAL_FRONTEND_RED');
