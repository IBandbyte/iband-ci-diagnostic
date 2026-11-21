import assert from 'node:assert/strict';
import {createStudioServerAuthorityAdapter} from './isolated-studio-server-authority-adapter.mjs';
const input={projectId:'p',operationId:'op',creatorTurnId:'t',expectedRevision:0,creatorMessage:{id:'t',role:'creator',text:'Scene'},mentorMessage:{id:'m',role:'mentor',text:'Ready',metadata:{backendMetadata:{creatorTurnId:'t'}}}};
const publications=[];
let receipt=null;
let resolveRead;
const adapter=createStudioServerAuthorityAdapter({settle:async()=>receipt,readConfirmed:async()=>({projectId:'p',revision:1,conversation:[input.creatorMessage,input.mentorMessage]}),publishConfirmed:async x=>publications.push(x)});
adapter.stage(input);
assert.equal((await adapter.restore('p')).status,'blocked-pending');
assert.equal(publications.length,0);
console.log('GREEN STUDIO_ADAPTER_PENDING_BLOCKS_RECOVERY_PUBLICATION');
const unknown=await adapter.confirm('p','t');
assert.equal(unknown.durable,false);assert.equal(adapter.hasPending('p','t'),true);
console.log('GREEN STUDIO_ADAPTER_UNKNOWN_RETAINS_PENDING');
receipt={operationId:'op',creatorTurnId:'t',serverCommitId:'commit-1',committedRevision:1};
assert.equal((await adapter.confirm('p','t')).durable,true);
assert.equal((await adapter.restore('p')).published,true);assert.equal(publications.length,1);
console.log('GREEN STUDIO_ADAPTER_MATCHED_RECEIPT_ALLOWS_CONFIRMED_READ');
const delayed=createStudioServerAuthorityAdapter({settle:async()=>null,readConfirmed:()=>new Promise(resolve=>{resolveRead=resolve}),publishConfirmed:async x=>publications.push(x)});
const inflight=delayed.restore('p');
delayed.stage(input);
resolveRead({projectId:'p',revision:1,conversation:[]});
assert.equal((await inflight).status,'stale-local-change');
assert.equal(publications.length,1);
console.log('GREEN STUDIO_ADAPTER_CONCURRENT_LOCAL_CHANGE_FENCES_RECOVERY');
const revisions=[3,2];const rollbackPublications=[];
const rollbackAdapter=createStudioServerAuthorityAdapter({
 settle:async()=>null,
 readConfirmed:async()=>({projectId:'rollback-project',revision:revisions.shift(),conversation:[]}),
 publishConfirmed:async recovered=>rollbackPublications.push(recovered)
});
assert.equal((await rollbackAdapter.restore('rollback-project')).published,true);
const rollback=await rollbackAdapter.restore('rollback-project');
assert.equal(rollback.published,false,'older confirmed read must not overwrite newer confirmed projection');
assert.equal(rollbackPublications.length,1);
console.log('GREEN STUDIO_ADAPTER_OLDER_SERVER_REVISION_CANNOT_ROLL_BACK_CONFIRMED_UI');
console.log('HELD REAL_CREATOR_WORKSPACE_WIRING_AND_ORIGINAL_FRONTEND_RED');
