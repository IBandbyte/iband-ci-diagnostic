import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {selectSecondFilmWithServerAuthority} from './isolated-original-continuity-second-film-migration.mjs';
import createCreatorMemory,{createMemoryStorageAdapter} from '../frontend/src/components/studio/mentor/CreatorMemory.js';
import createMovieMentorStudioIdentityRuntime from '../frontend/src/components/studio/mentor/MovieMentorStudioIdentityRuntime.js';
const original=readFileSync('./frontend/scripts/verify-movie-mentor-conversation-continuity.mjs','utf8');
const exact=`const cleared = await memoryB.replaceStateWithSharedAuthority({
  locks,
  transform: state => {
    state.journey = { ...(state.journey || {}), activeProjectId: null };
    return state;
  },
});
assert.equal(cleared.acquired, true);`;
assert.equal(original.split(exact).length,2,'pinned original second-film caller has drifted');
const originalRun=spawnSync(process.execPath,['./frontend/scripts/verify-movie-mentor-conversation-continuity.mjs'],{encoding:'utf8'});
assert.equal(originalRun.status,1);
assert.match(originalRun.stderr,/verify-movie-mentor-conversation-continuity\.mjs:71/);
assert.match(originalRun.stderr,/false !== true/);
console.log('GREEN ORIGINAL_SECOND_FILM_CALLER_LINE_71_RED_REPRODUCED_UNMODIFIED');
const storage=createMemoryStorageAdapter();
let idx=0;
const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'];
const cryptoImpl={randomUUID:()=>ids[idx++]};
const locks={request:async(_,optionsOrCallback,maybeCallback)=>(typeof optionsOrCallback==='function'?optionsOrCallback:maybeCallback)({name:'exclusive',mode:'exclusive'})};
const first=createCreatorMemory({storageAdapter:storage,projectIdentityCrypto:cryptoImpl,requireSharedWriteAuthority:true});
const writer=createMovieMentorStudioIdentityRuntime({memory:first,cryptoImpl,settlementLockManager:locks});
const created=await writer.ensureProjectWithSharedAuthority({title:'First movie',projectJourney:{currentStageId:'story'},locks});
assert.equal(created.acquired,true);
const firstId=writer.getActiveProject().id;
writer.recordConversationMessage(firstId,{role:'creator',text:'First movie opening'},{projectJourney:{currentStageId:'story'}});
const settled=await writer.settleConversationMessage(firstId,{role:'mentor',text:'First movie response',metadata:{backendMetadata:{creatorTurnId:'turn-one'}}},{projectJourney:{currentStageId:'story'}});
assert.equal(settled.status,'conversation-persisted');
const restarted=createCreatorMemory({storageAdapter:storage,projectIdentityCrypto:cryptoImpl,requireSharedWriteAuthority:true});
const originalBytes=storage.getItem('iband.creator-memory');
const getLocalBytes=()=>storage.getItem('iband.creator-memory');
const denied=await restarted.replaceStateWithSharedAuthority({locks,transform:s=>({...s,journey:{...s.journey,activeProjectId:null}})});
assert.deepEqual(denied,{acquired:false,reason:'publication-outbox-provenance-unverified'});
assert.equal(getLocalBytes(),originalBytes);
const state={film:'film-a',revision:1,denySwitch:false,denyRead:false,mutateLocal:false};
let calls=[],editableCalls=0;
const coordinator={
 async open({token,selectionVaultId}){calls.push('open');return token==='owner'&&selectionVaultId==='vault'
  ?{ok:true,view:{projectId:state.film,writable:false}}:{ok:false}},
 async switchFilm({token,selectionVaultId,nextProjectId,operationId}){
  calls.push('switch');
  if(state.denySwitch||token!=='owner'||selectionVaultId!=='vault'||!operationId)return {ok:false};
  state.film=nextProjectId;state.revision++;
  if(state.mutateLocal)storage.setItem('iband.creator-memory','unauthorised-local-rebase');
  return {ok:true,view:{projectId:nextProjectId,writable:false,selectionRevision:state.revision}};
 },
 async recover({token,selectionVaultId}){calls.push('recover');
  return !state.denyRead&&token==='owner'&&selectionVaultId==='vault'
   ?{ok:true,view:{mode:'read-only',projectId:state.film,writable:false,
      selectionRevision:state.revision,scenes:[{id:'second-scene',text:'Independent second film'}]}}:{ok:false};
 },
 async requestEditing(){editableCalls++;throw Error('not-authorised-to-admit')}
};
const args={coordinator,token:'owner',selectionVaultId:'vault',nextProjectId:'film-b',
 selectionOperationId:'select-b',localMemory:restarted,originalBytes,getLocalBytes};
const adopted=await selectSecondFilmWithServerAuthority(args);
assert.deepEqual(calls,['open','switch','recover']);
assert.equal(adopted.ok,true);
assert.equal(adopted.mode,'read-only');
assert.equal(adopted.writable,false);
assert.deepEqual(adopted.scenes,[{id:'second-scene',text:'Independent second film'}]);
assert.equal(editableCalls,0);
assert.equal(getLocalBytes(),originalBytes);
assert.equal(restarted.getActiveProject()?.id,firstId);
const deniedAgain=await restarted.replaceStateWithSharedAuthority({locks,transform:s=>({...s,journey:{...s.journey,activeProjectId:null}})});
assert.equal(deniedAgain.acquired,false);
assert.equal(deniedAgain.reason,'publication-outbox-provenance-unverified');
console.log('GREEN MIGRATED_SECOND_FILM_READ_ONLY_SELECTION_WITHOUT_LOCAL_WRITER_GRANT');
for(const condition of ['denySwitch','denyRead','mutateLocal']){
 calls=[];
 state.film='film-a';state.revision=1;
 state[condition]=true;
 const result=await selectSecondFilmWithServerAuthority(args);
 assert.equal(result.ok,false,condition);
 assert.equal(result.writable,undefined);
 assert.equal(editableCalls,0);
 state[condition]=false;
 if(condition==='mutateLocal')storage.setItem('iband.creator-memory',originalBytes);
 assert.equal(getLocalBytes(),originalBytes);
}
const malformed=await selectSecondFilmWithServerAuthority({...args,token:null});
assert.equal(malformed.ok,false);
assert.equal(editableCalls,0);
console.log('GREEN MIGRATED_SECOND_FILM_DENIES_FAILED_SELECTION_READBACK_AND_LOCAL_TAMPER');
console.log('HELD ORIGINAL_FRONTEND_RED_AND_PHYSICAL_SOURCE_APPLICATION_ADOPTION');
