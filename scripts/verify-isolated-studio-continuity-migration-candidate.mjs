import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createIsolatedStudioContinuityMigration} from './isolated-studio-continuity-migration-candidate.mjs';
const frontend=readFileSync('./frontend/src/components/studio/CreatorWorkspace.jsx','utf8');
const continuity=readFileSync('./frontend/scripts/verify-movie-mentor-conversation-continuity.mjs','utf8');
const memory=readFileSync('./frontend/src/components/studio/mentor/CreatorMemory.js','utf8');
assert.match(frontend,/const \[activeMovieProject, setActiveMovieProject\] = useState\(resumeSnapshot\?\.project \|\| null\)/);
assert.match(frontend,/const handleMovieMessage = \(message\) =>/);
assert.match(frontend,/This is a read-only preview; editing is not enabled/);
assert.match(continuity,/assert\.equal\(cleared\.acquired, true\)/);
assert.match(memory,/publication-outbox-provenance-unverified/);
console.log('GREEN SOURCE_PINNED_STUDIO_CONTINUITY_MIGRATION_SEAMS_AND_ORIGINAL_RED_UNCHANGED');
const state={film:'film-a',selectionRevision:1,blocked:false,wrongReceipt:false,readDenied:false,grantDenied:false,permit:false};
let read=null,admission=null;const views=[],calls={changes:0,recovery:0,grant:0};
const selection={
 getSnapshot:()=>({projectId:'vault',activeProjectId:state.film,revision:state.selectionRevision}),
 invalidate:()=>{},
 load:async({token,projectId})=>token==='owner'&&projectId==='vault'
  ?{ok:true,selection:{projectId,activeProjectId:state.film,revision:state.selectionRevision}}:{ok:false},
 change:async({token,projectId,nextActiveProjectId})=>{
  calls.changes++;
  if(token!=='owner'||projectId!=='vault'||state.blocked)return {ok:false};
  state.film=nextActiveProjectId;state.selectionRevision++;
  return {ok:true,selection:{projectId,activeProjectId:state.film,revision:state.selectionRevision}};
 }
};
const recovery={
 invalidate:()=>{read=null},
 getSnapshot:()=>read&&structuredClone(read),
 inspect:async({token,selectionVaultId,projectId})=>{
  calls.recovery++;
  if(token!=='owner'||selectionVaultId!=='vault'||projectId!==state.film||state.readDenied)return {ok:false};
  read={selectionVaultId,projectId,selectionRevision:state.selectionRevision,
    projectRevision:projectId==='film-b'?4:1,
    scenes:[{id:'scene-one',text:projectId+' opening'}],readOnly:true,writable:false};
  return {ok:true,snapshot:structuredClone(read)};
 }
};
const editable={
 invalidate:()=>{admission=null},
 getSnapshot:()=>admission,
 activate:async({token,selectionVaultId,readOnlySnapshot,operationId})=>{
  calls.grant++;
  if(token!=='owner'||selectionVaultId!=='vault'||state.grantDenied||
     readOnlySnapshot.projectId!==state.film)return {ok:false};
  admission={projectId:state.film,selectionRevision:state.selectionRevision,
    operationId,fence:'server-fence',writable:true,serverOwned:true};
  return {ok:true,adoption:admission};
 }
};
const coordinator=createIsolatedStudioContinuityMigration({selection,recovery,editable,onView:x=>views.push(x)});
assert.equal((await coordinator.requestEditing({token:'owner',selectionVaultId:'vault',operationId:'early'})).ok,false);
assert.equal(calls.grant,0);
assert.equal((await coordinator.open({token:'owner',selectionVaultId:'vault'})).ok,true);
assert.equal(coordinator.getSnapshot().writable,false);
assert.equal((await coordinator.requestEditing({token:'owner',selectionVaultId:'vault',operationId:'too-early'})).ok,false);
assert.equal(calls.grant,0);
state.blocked=true;
assert.equal((await coordinator.switchFilm({token:'owner',selectionVaultId:'vault',operationId:'deny',nextProjectId:'film-b'})).ok,false);
assert.equal(coordinator.getSnapshot().writable,false);
state.blocked=false;
assert.equal((await coordinator.open({token:'owner',selectionVaultId:'vault'})).ok,true);
const switched=await coordinator.switchFilm({token:'owner',selectionVaultId:'vault',operationId:'choose-b',nextProjectId:'film-b'});
assert.equal(switched.ok,true);assert.equal(switched.view.projectId,'film-b');
assert.equal(switched.view.writable,false);
console.log('GREEN SOURCE_PINNED_CONTINUITY_SELECTION_CANNOT_GRANT_WRITER');
state.readDenied=true;
assert.equal((await coordinator.recover({token:'owner',selectionVaultId:'vault'})).ok,false);
assert.equal(calls.grant,0);
state.readDenied=false;
assert.equal((await coordinator.open({token:'owner',selectionVaultId:'vault'})).ok,true);
const recovered=await coordinator.recover({token:'owner',selectionVaultId:'vault'});
assert.equal(recovered.ok,true);assert.equal(recovered.view.mode,'read-only');
assert.equal(recovered.view.projectRevision,4);
state.grantDenied=true;
assert.equal((await coordinator.requestEditing({token:'owner',selectionVaultId:'vault',operationId:'adopt-b'})).ok,false);
assert.equal(coordinator.getSnapshot().writable,false);
state.grantDenied=false;
const accepted=await coordinator.requestEditing({token:'owner',selectionVaultId:'vault',operationId:'adopt-b'});
assert.equal(accepted.ok,true);
assert.equal(accepted.view.projectId,'film-b');assert.equal(accepted.view.serverOwned,true);
assert.equal(accepted.view.fence,'server-fence');
console.log('GREEN SOURCE_PINNED_CONTINUITY_OWNER_READBACK_BEFORE_FENCED_EDITABLE_PROJECTION');
state.blocked=true;
assert.equal((await coordinator.switchFilm({token:'owner',selectionVaultId:'vault',operationId:'fail-switch',nextProjectId:'film-a'})).ok,false);
assert.equal(coordinator.getSnapshot().writable,false);
assert.equal(editable.getSnapshot(),null);
state.blocked=false;
assert.equal((await coordinator.open({token:'owner',selectionVaultId:'vault'})).ok,true);
assert.equal(coordinator.getSnapshot().writable,false);
coordinator.invalidate();
assert.equal(coordinator.getSnapshot(),null);
assert.equal(editable.getSnapshot(),null);
console.log('GREEN SOURCE_PINNED_CONTINUITY_SWITCH_INVALIDATES_OLD_FENCE_AND_RESTART_FAILS_CLOSED');
console.log('HELD ORIGINAL_FRONTEND_RED_AND_PINNED_APP_MIGRATION_PHYSICAL_CERTIFICATION');
