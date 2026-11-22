import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createIsolatedApplicationRecoveryAdoption} from './isolated-application-recovery-adoption-boundary.mjs';
// Keep the exact frontend application source and original regression intact.
const source=readFileSync('./frontend/src/components/studio/CreatorWorkspace.jsx','utf8');
const original=readFileSync('./frontend/scripts/verify-movie-mentor-conversation-continuity.mjs','utf8');
assert.match(source,/This is a read-only preview; editing is not enabled/);
assert.match(source,/must not be written[\s\S]*into the local identity runtime without an explicit adoption fence/);
assert.match(source,/settleConversationMessage\(activeMovieProject\.id, message/);
assert.match(original,/assert\.equal\(cleared\.acquired, true\)/);
console.log('GREEN APPLICATION_RECOVERY_ORIGINAL_READ_ONLY_AND_RED_SOURCE_UNCHANGED');
let selected='film-b', selectionRevision=2,projectRevision=4,mode='ok',calls=0;
const callbacks=[];
let wait,release;
const readSelected=async ({token,projectId})=>{
 calls++;
 if(mode==='hang'&&calls%3===1)await new Promise(resolve=>{release=resolve});
 if(token!=='owner')return {ok:false};
 return {ok:true,projectId,activeProjectId:mode==='wrongfilm'?'film-a':selected,revision:selectionRevision};
};
const readProject=async ({token,projectId})=>{
 if(token!=='owner')return {ok:false};
 if(mode==='unavailable')throw Error('socket-lost');
 return {ok:mode!=='unowned',projectId:mode==='wrongproject'?'film-a':projectId,
  revision:mode==='invalidrevision'?-1:projectRevision,
  state:{scenes:mode==='badscene'?[{id:null,text:'bad'}]:[{id:'scene-b-next',text:'Film B next confirmed scene'}]}};
};
const gate=createIsolatedApplicationRecoveryAdoption({readSelected,readProject,onVerifiedReadOnly:value=>callbacks.push(value)});
const args={token:'owner',selectionVaultId:'vault',projectId:'film-b'};
for(const kind of ['wrongfilm','unowned','wrongproject','invalidrevision','badscene','unavailable']){
 mode=kind;
 const r=await gate.inspect(args);
 assert.equal(r.ok,false,kind);
 assert.equal(callbacks.length,0,kind);
}
mode='ok';
assert.equal((await gate.inspect({...args,token:'intruder'})).ok,false);
assert.equal(callbacks.length,0);
const approved=await gate.inspect(args);
assert.equal(approved.ok,true);assert.equal(approved.mode,'read-only');
assert.equal(approved.snapshot.writable,false);
assert.equal(approved.snapshot.projectId,'film-b');
assert.equal(approved.snapshot.projectRevision,4);
assert.equal(approved.snapshot.scenes.length,1);
assert.equal(callbacks.length,1);
console.log('GREEN APPLICATION_RECOVERY_REQUIRES_OWNER_SELECTION_AND_DURABLE_SCENE_READBACK');
selected='film-a';selectionRevision=3;
const lost=await gate.inspect(args);
assert.equal(lost.ok,false);
assert.equal(callbacks.length,1);
console.log('GREEN APPLICATION_RECOVERY_REJECTS_CROSS_FILM_SELECTION_WITHOUT_PROJECTION');
selected='film-b';selectionRevision=4;
mode='hang';
calls=0;
const pending=gate.inspect(args);
for(let n=0;n<50&&!release;n++)await Promise.resolve();
assert.equal(typeof release,'function');
gate.invalidate();release();
assert.equal((await pending).reason,'stale-request');
assert.equal(gate.getSnapshot(),null);
assert.equal(callbacks.length,1);
console.log('GREEN APPLICATION_RECOVERY_CANCELLED_ASYNC_SELECTION_CANNOT_ADOPT');
console.log('HELD APPLICATION_EDITABLE_ADOPTION_AND_ORIGINAL_FRONTEND_CONTINUITY_RED');
