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
const readResolvers=[];const overlappingPublications=[];
const overlapping=createStudioServerAuthorityAdapter({
 settle:async()=>null,
 readConfirmed:()=>new Promise(resolve=>readResolvers.push(resolve)),
 publishConfirmed:async recovered=>overlappingPublications.push(recovered)
});
const olderInflight=overlapping.restore('overlap-project');
const newerInflight=overlapping.restore('overlap-project');
assert.equal(readResolvers.length,2);
readResolvers[1]({projectId:'overlap-project',revision:3,conversation:[]});
assert.equal((await newerInflight).published,true);
readResolvers[0]({projectId:'overlap-project',revision:2,conversation:[]});
assert.equal((await olderInflight).published,false,'late older recovery must not overwrite newer publication');
assert.deepEqual(overlappingPublications.map(x=>x.revision),[3]);
console.log('GREEN STUDIO_ADAPTER_OVERLAPPING_RECOVERY_LATE_OLDER_REVISION_DENIED');
let enterPublish;let releasePublish;
const publishEntered=new Promise(resolve=>{enterPublish=resolve});
const publishRelease=new Promise(resolve=>{releasePublish=resolve});
const publicationEvents=[];
const publishing=createStudioServerAuthorityAdapter({
 settle:async()=>null,
 readConfirmed:async()=>({projectId:'publication-race',revision:4,conversation:[]}),
 publishConfirmed:async recovered=>{
  publicationEvents.push('begin-'+recovered.revision);
  enterPublish();
  await publishRelease;
  publicationEvents.push('commit-'+recovered.revision);
 }
});
const publishingInflight=publishing.restore('publication-race');
await publishEntered;
publishing.stage({...input,projectId:'publication-race'});
releasePublish();
const publicationRace=await publishingInflight;
assert.equal(publicationRace.published,false,'local edit during asynchronous publication must not be certified as confirmed');
assert.equal(publicationEvents.includes('commit-4'),false,'stale asynchronous publication must not commit after local edit');
console.log('GREEN STUDIO_ADAPTER_ASYNC_PUBLICATION_LOCAL_EDIT_FENCED');
console.log('HELD REAL_CREATOR_WORKSPACE_WIRING_AND_ORIGINAL_FRONTEND_RED');
