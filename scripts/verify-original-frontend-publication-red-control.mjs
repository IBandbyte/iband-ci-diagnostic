// Exact pinned frontend continuity RED, preserved as a required negative control.
// This is NOT a fix. The underlying original regression must remain unchanged.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import createCreatorMemory,{createMemoryStorageAdapter} from '../src/components/studio/mentor/CreatorMemory.js';
import createMovieMentorStudioIdentityRuntime from '../src/components/studio/mentor/MovieMentorStudioIdentityRuntime.js';
const regression=readFileSync('./scripts/verify-movie-mentor-conversation-continuity.mjs','utf8');
assert.match(regression,/assert\.equal\(cleared\.acquired, true\)/,'original continuity assertion must be unchanged');
const original=spawnSync(process.execPath,['scripts/verify-movie-mentor-conversation-continuity.mjs'],{encoding:'utf8',timeout:25000});
const diagnostics=(original.stderr||'')+'\n'+(original.stdout||'');
assert.equal(original.status,1,'original frontend continuity RED must not be silently changed or suppressed');
assert.match(diagnostics,/AssertionError/);
assert.match(diagnostics,/false !== true/);
assert.match(diagnostics,/verify-movie-mentor-conversation-continuity\.mjs/);
console.log('GREEN ORIGINAL_FRONTEND_CONTINUITY_RED_UNCHANGED_NEGATIVE_CONTROL');

const storage=createMemoryStorageAdapter();
let id=0;
const uuids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'];
const cryptoImpl={randomUUID:()=>uuids[id++]};
const locks={request:async(name,optionsOrCallback,maybeCallback)=>{
 const callback=typeof optionsOrCallback==='function'?optionsOrCallback:maybeCallback;
 return callback({name,mode:'exclusive'});
}};
const first=createCreatorMemory({storageAdapter:storage,projectIdentityCrypto:cryptoImpl,requireSharedWriteAuthority:true});
const runtime=createMovieMentorStudioIdentityRuntime({memory:first,cryptoImpl,settlementLockManager:locks});
const creation=await runtime.ensureProjectWithSharedAuthority({title:'Publication boundary',projectJourney:{currentStageId:'story'}});
assert.equal(creation.acquired,true);
const project=runtime.getActiveProject();
assert.ok(project?.id);
runtime.recordConversationMessage(project.id,{role:'creator',text:'First scene'},{projectJourney:{currentStageId:'story'}});
const settled=await runtime.settleConversationMessage(project.id,{role:'mentor',text:'Next shot',metadata:{backendMetadata:{creatorTurnId:'publication-turn'}}},{projectJourney:{currentStageId:'story'}});
assert.equal(settled.status,'conversation-persisted');
const restarted=createCreatorMemory({storageAdapter:storage,projectIdentityCrypto:cryptoImpl,requireSharedWriteAuthority:true});
const originalBytes=storage.getItem('iband.creator-memory');
const persisted=restarted.readPersistedState();
assert.ok(Array.isArray(persisted.durablePublicationOutbox)&&persisted.durablePublicationOutbox.length>0);
const denied=await restarted.replaceStateWithSharedAuthority({
 locks,
 transform:state=>({...state,journey:{...(state.journey||{}),activeProjectId:null}})
});
assert.equal(denied.acquired,false);
assert.equal(denied.reason,'publication-outbox-provenance-unverified');
assert.equal(storage.getItem('iband.creator-memory'),originalBytes,'denial must not alter persisted bytes');
console.log('GREEN ORIGINAL_FRONTEND_RESTART_UNWITNESSED_PUBLICATION_DENIED_WITHOUT_MUTATION');
console.log('HELD POSITIVE_RESTART_WRITER_AUTHORITY_AND_ORIGINAL_FRONTEND_RED');
