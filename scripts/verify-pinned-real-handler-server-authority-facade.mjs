// Runs the actual pinned Studio handler against an isolated server-authority facade.
// The facade is test-only: no frontend code is modified or certified as integrated.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createStudioServerAuthorityAdapter} from './isolated-studio-server-authority-adapter.mjs';
const source=readFileSync('frontend/src/components/studio/CreatorWorkspace.jsx','utf8');
const match=source.match(/const handleMovieMessage = \(message\) => \{([\s\S]*?)\n  \};/);
assert.ok(match,'pinned real handler required');
const projectId='studio-real-handler-project',creatorTurnId='creator-turn-1',operationId='operation-1';
const publications=[];let receipt=null,display=[],status='idle',notice='',pendingCreator=null;
const inputFor=(creatorMessage,mentorMessage)=>({projectId,operationId,creatorTurnId,expectedRevision:0,creatorMessage,mentorMessage});
const adapter=createStudioServerAuthorityAdapter({
 settle:async()=>receipt,
 readConfirmed:async()=>({projectId,revision:1,conversation:[pendingCreator,{id:'mentor-1',role:'mentor',text:'Ready'}]}),
 publishConfirmed:async recovered=>publications.push(recovered)
});
const identityRuntime={
 recordPendingCreatorMessage:(id,message)=>{assert.equal(id,projectId);pendingCreator=message;},
 settleConversationMessage:async(id,message)=>{
  assert.equal(id,projectId);assert.ok(pendingCreator,'creator turn must be staged first');
  adapter.stage(inputFor(pendingCreator,message));
  const result=await adapter.confirm(id,creatorTurnId);
  if(!result.durable)throw Error('server-outcome-unknown');
  return result;
 }
};
const handler=new Function('setMovieMessages','activeMovieProject','projectJourneySnapshot','projectJourney','identityRuntime','setProjectStatus','setMentorMessage','console',`return (message) => {${match[1]}
}`)(
 updater=>{display=updater(display)},{id:projectId},null,null,identityRuntime,
 value=>{status=value},value=>{notice=value},{error:()=>{}}
);
handler({id:creatorTurnId,role:'creator',text:'Scene'});
handler({id:'mentor-1',role:'mentor',text:'Ready'});
await new Promise(resolve=>setImmediate(resolve));
assert.equal(adapter.hasPending(projectId,creatorTurnId),true);
assert.equal((await adapter.restore(projectId)).status,'blocked-pending');
assert.equal(publications.length,0);assert.equal(status,'error');assert.match(notice,/pending creator turn has been kept/);
console.log('GREEN REAL_HANDLER_FACADE_UNKNOWN_RESULT_RETAINS_PENDING_AND_BLOCKS_PUBLICATION');
receipt={operationId,creatorTurnId,serverCommitId:'commit-1',committedRevision:1};
assert.equal((await adapter.confirm(projectId,creatorTurnId)).durable,true);
assert.equal((await adapter.restore(projectId)).published,true);
assert.equal(publications.length,1);
assert.equal(display.length,2,'existing handler remains optimistic; publication is separately server-confirmed');
console.log('GREEN REAL_HANDLER_FACADE_RECEIPT_ADMITS_CONFIRMED_RECOVERY');
console.log('HELD PRODUCTION_CREATOR_WORKSPACE_WIRING_AND_ORIGINAL_FRONTEND_RED');
