// Independent original-RED reconciliation court. The old source-exact test
// MUST continue to fail at its legacy local writer expectation. An alternative
// server-owned route must recover a different project without mutating local
// publication history. This is diagnostic evidence, NOT a patched original test.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import createCreatorMemory,{createMemoryStorageAdapter} from '../frontend/src/components/studio/mentor/CreatorMemory.js';
import createMovieMentorStudioIdentityRuntime from '../frontend/src/components/studio/mentor/MovieMentorStudioIdentityRuntime.js';
import {createIsolatedStudioContinuityMigration} from './isolated-studio-continuity-migration-candidate.mjs';
const old=readFileSync('./frontend/scripts/verify-movie-mentor-conversation-continuity.mjs','utf8');
const core=readFileSync('./frontend/src/components/studio/mentor/CreatorMemory.js','utf8');
assert.match(old,/const memoryB = createCreatorMemory/);
assert.match(old,/const cleared = await memoryB\.replaceStateWithSharedAuthority/);
assert.match(old,/assert\.equal\(cleared\.acquired, true\)/);
assert.match(core,/MOVIE_MENTOR_PUBLICATION_OUTBOX_PROVENANCE_UNVERIFIED/);
const result=spawnSync(process.execPath,['./frontend/scripts/verify-movie-mentor-conversation-continuity.mjs'],{encoding:'utf8'});
assert.equal(result.status,1,'original regression unexpectedly changed verdict');
assert.match(result.stderr,/AssertionError/);
assert.match(result.stderr,/false !== true/);
assert.match(result.stderr,/verify-movie-mentor-conversation-continuity\.mjs:71/);
console.log('GREEN RECONCILIATION_ORIGINAL_UNMODIFIED_LINE_71_RED_REPRODUCED');
const storage=createMemoryStorageAdapter();
let next=0;
const uuids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'];
const cryptoImpl={randomUUID:()=>uuids[next++]};
const locks={request:async(name,optionsOrCallback,callback)=>(
 typeof optionsOrCallback==='function'?optionsOrCallback:callback)({name,mode:'exclusive'})};
const localA=createCreatorMemory({storageAdapter:storage,projectIdentityCrypto:cryptoImpl,requireSharedWriteAuthority:true});
const runtimeA=createMovieMentorStudioIdentityRuntime({memory:localA,cryptoImpl,settlementLockManager:locks});
const created=await runtimeA.ensureProjectWithSharedAuthority({title:'Midnight Door',projectJourney:{currentStageId:'story'},locks});
assert.equal(created.acquired,true);
const localId=runtimeA.getActiveProject().id;
runtimeA.recordConversationMessage(localId,{role:'creator',text:'The red door should appear at midnight.'},{projectJourney:{currentStageId:'story'}});
const settled=await runtimeA.settleConversationMessage(localId,{role:'mentor',text:'Good. Midnight is the trigger.',metadata:{backendMetadata:{creatorTurnId:'midnight-door-turn-1'}}},{projectJourney:{currentStageId:'story'}});
assert.equal(settled.status,'conversation-persisted');
const restarted=createCreatorMemory({storageAdapter:storage,projectIdentityCrypto:cryptoImpl,requireSharedWriteAuthority:true});
const bytes=storage.getItem('iband.creator-memory');
const denied=await restarted.replaceStateWithSharedAuthority({locks,transform:state=>({...state,journey:{...(state.journey||{}),activeProjectId:null}})});
assert.deepEqual(denied,{acquired:false,reason:'publication-outbox-provenance-unverified'});
assert.equal(storage.getItem('iband.creator-memory'),bytes);
const durable={selected:'film-a',revision:1,scenes:{'film-b':[{id:'scene-b-1',text:'Second film confirmed'}]}};
let selectionSnapshot=null,recoverySnapshot=null,editSnapshot=null,authorityCalls=0;
const selection={
 invalidate(){selectionSnapshot=null},
 getSnapshot(){return selectionSnapshot&&structuredClone(selectionSnapshot)},
 async load({token,projectId}){if(token!=='owner-token'||projectId!=='vault')return {ok:false};selectionSnapshot={projectId,activeProjectId:durable.selected,revision:durable.revision};return {ok:true,selection:structuredClone(selectionSnapshot)}},
 async change({token,projectId,operationId,nextActiveProjectId}){if(token!=='owner-token'||projectId!=='vault'||!operationId||nextActiveProjectId!=='film-b')return {ok:false};durable.selected=nextActiveProjectId;durable.revision++;selectionSnapshot={projectId,activeProjectId:durable.selected,revision:durable.revision};return {ok:true,selection:structuredClone(selectionSnapshot)}}
};
const recovery={
 invalidate(){recoverySnapshot=null},
 getSnapshot(){return recoverySnapshot&&structuredClone(recoverySnapshot)},
 async inspect({token,selectionVaultId,projectId}){if(token!=='owner-token'||selectionVaultId!=='vault'||projectId!==durable.selected)return {ok:false};recoverySnapshot={selectionVaultId,projectId,selectionRevision:durable.revision,projectRevision:4,scenes:structuredClone(durable.scenes[projectId]),readOnly:true,writable:false};return {ok:true,snapshot:structuredClone(recoverySnapshot)}}
};
const editable={
 invalidate(){editSnapshot=null},
 getSnapshot(){return editSnapshot&&structuredClone(editSnapshot)},
 async activate({token,selectionVaultId,readOnlySnapshot,operationId}){authorityCalls++;if(token!=='owner-token'||selectionVaultId!=='vault'||!readOnlySnapshot?.readOnly||!operationId)return {ok:false};editSnapshot={projectId:'film-b',selectionRevision:durable.revision,operationId,fence:'server-fence',writable:true,serverOwned:true};return {ok:true,adoption:structuredClone(editSnapshot)}}
};
const coordinator=createIsolatedStudioContinuityMigration({selection,recovery,editable,onView:()=>{}});
const req={token:'owner-token',selectionVaultId:'vault'};
assert.equal((await coordinator.open(req)).ok,true);
assert.equal((await coordinator.requestEditing({...req,operationId:'early'})).ok,false);
assert.equal(authorityCalls,0);
assert.equal((await coordinator.open(req)).ok,true);
const switched=await coordinator.switchFilm({...req,operationId:'choose-film-b',nextProjectId:'film-b'});
assert.equal(switched.ok,true);assert.equal(switched.view.writable,false);
const found=await coordinator.recover(req);
assert.equal(found.ok,true);assert.equal(found.view.mode,'read-only');
assert.deepEqual(found.view.scenes,durable.scenes['film-b']);
assert.equal(storage.getItem('iband.creator-memory'),bytes);
console.log('GREEN RECONCILIATION_SERVER_SELECTED_DISTINCT_FILM_READ_ONLY_WITHOUT_LOCAL_REBASE');
const admission=await coordinator.requestEditing({...req,operationId:'adopt-film-b'});
assert.equal(admission.ok,true);
assert.equal(admission.view.serverOwned,true);
assert.equal(admission.view.fence,'server-fence');
assert.equal(storage.getItem('iband.creator-memory'),bytes);
coordinator.invalidate();
assert.equal(coordinator.getSnapshot(),null);
assert.equal(editable.getSnapshot(),null);
const after=await restarted.replaceStateWithSharedAuthority({locks,transform:state=>({...state,journey:{...(state.journey||{}),activeProjectId:null}})});
assert.equal(after.acquired,false);
assert.equal(after.reason,'publication-outbox-provenance-unverified');
assert.equal(storage.getItem('iband.creator-memory'),bytes);
console.log('GREEN RECONCILIATION_SERVER_ADMISSION_AND_RESTART_NEVER_WITNESS_LOCAL_OUTBOX');
console.log('HELD ORIGINAL_FRONTEND_RED_SOURCE_MIGRATION_UNCERTIFIED');
