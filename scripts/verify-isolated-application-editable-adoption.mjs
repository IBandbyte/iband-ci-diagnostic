import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createIsolatedApplicationEditableAdoption} from './isolated-application-editable-adoption-boundary.mjs';
const source=readFileSync('./frontend/src/components/studio/CreatorWorkspace.jsx','utf8');
const original=readFileSync('./frontend/scripts/verify-movie-mentor-conversation-continuity.mjs','utf8');
assert.match(source,/This is a read-only preview; editing is not enabled/);
assert.match(original,/assert\.equal\(cleared\.acquired, true\)/);
const snapshot={selectionVaultId:'vault',projectId:'film-b',selectionRevision:2,projectRevision:4,scenes:[{id:'scene-b-next',text:'Film B next confirmed scene'}],readOnly:true,writable:false};
let mode='ok',runs=0,grantCalls=0,admitCalls=0;
const events=[];
const isOwner=t=>t==='owner';
const api={
 readSelected:async({token,projectId})=>({ok:isOwner(token),projectId,revision:mode==='stale-selection'?3:2,activeProjectId:mode==='wrong-film'?'film-a':'film-b'}),
 readProject:async({token,projectId})=>({ok:isOwner(token),projectId,revision:mode==='stale-project'?5:4,state:{scenes:mode==='different-scenes'?[]:snapshot.scenes}}),
 issueGrant:async({token,projectId,revision})=>{grantCalls++;return mode==='grant-denied'?null:{grantId:'independent-grant',projectId,revision}},
 admit:async({token,projectId,operationId,revision})=>{admitCalls++;return mode==='admission-denied'?{acquired:false}:{acquired:true,projectId,operationId,revision,fence:'server-fence-1'}},
 readAdmission:async({projectId,operationId})=>mode==='receipt-denied'?null:{projectId,operationId,revision:4,fence:mode==='wrong-fence'?'forged':'server-fence-1'},
 onVerifiedEditable:x=>events.push(x)
};
const gate=createIsolatedApplicationEditableAdoption(api);
const args={token:'owner',selectionVaultId:'vault',readOnlySnapshot:snapshot,operationId:'adopt-b'};
assert.equal((await gate.activate({...args,readOnlySnapshot:{...snapshot,readOnly:false,writable:true}})).ok,false);
assert.equal(grantCalls,0);
assert.equal((await gate.activate({...args,token:'intruder'})).ok,false);
assert.equal(grantCalls,0);
for(const kind of ['wrong-film','stale-selection','stale-project','different-scenes','grant-denied','admission-denied','receipt-denied','wrong-fence']){
 mode=kind;
 const out=await gate.activate(args);
 assert.equal(out.ok,false,kind);
 assert.equal(events.length,0,kind);
 assert.equal(gate.getSnapshot(),null,kind);
}
console.log('GREEN APPLICATION_EDITABLE_ADOPTION_WRONG_OWNER_SELECTION_REVISION_AND_GRANT_DENIAL');
console.log('GREEN APPLICATION_EDITABLE_ADOPTION_FENCED_RECEIPT_REQUIRED_WITHOUT_OPTIMISTIC_EDITING');
mode='ok';
const accepted=await gate.activate(args);
assert.equal(accepted.ok,true);
assert.equal(accepted.adoption.projectId,'film-b');
assert.equal(accepted.adoption.writable,true);
assert.equal(accepted.adoption.serverOwned,true);
assert.equal(accepted.adoption.fence,'server-fence-1');
assert.equal(events.length,1);
assert.equal(admitCalls>0,true);
console.log('GREEN APPLICATION_EDITABLE_ADOPTION_SERVER_GRANT_FENCE_AND_READBACK_CONFIRMED');
gate.invalidate();
assert.equal(gate.getSnapshot(),null);
console.log('GREEN APPLICATION_EDITABLE_ADOPTION_INVALIDATE_CLEARS_LOCAL_PROJECTION');
console.log('HELD PHYSICAL_REACT_HTTP_MONGO_EDITABLE_ADOPTION_AND_ORIGINAL_FRONTEND_RED');
