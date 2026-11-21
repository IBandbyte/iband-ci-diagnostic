import assert from 'node:assert/strict';
import {MongoClient} from 'mongodb';
import {validateConversationSettlement,classifySettlementOutcome} from './isolated-conversation-settlement-contract.mjs';
const client=new MongoClient(process.env.MONGO_URI,{serverSelectionTimeoutMS:10000});
await client.connect();
const db=client.db('isolated_conversation_settlement_court'),projects=db.collection('projects'),receipts=db.collection('receipts');
await projects.deleteMany({});await receipts.deleteMany({});
await receipts.createIndex({projectId:1,operationId:1},{unique:true});
await receipts.createIndex({projectId:1,creatorTurnId:1},{unique:true});
const base={projectId:'physical-project',operationId:'operation-1',creatorTurnId:'turn-1',expectedRevision:0,creatorMessage:{id:'turn-1',role:'creator',text:'Scene one'},mentorMessage:{id:'mentor-1',role:'mentor',text:'We can create it',metadata:{backendMetadata:{creatorTurnId:'turn-1'}}}};
await projects.insertOne({_id:base.projectId,ownerId:'owner-1',revision:0,conversation:[]});
async function settle(input,ownerId='owner-1'){
 const valid=validateConversationSettlement(input);
 const session=client.startSession();
 try{return await session.withTransaction(async()=>{
  const prior=await receipts.findOne({projectId:valid.projectId,operationId:valid.operationId},{session});
  if(prior){assert.equal(prior.creatorTurnId,valid.creatorTurnId);return prior}
  const project=await projects.findOne({_id:valid.projectId},{session});
  if(!project||project.ownerId!==ownerId)throw Error('owner-denied');
  if(project.revision!==valid.expectedRevision)throw Error('stale-revision');
  const existing=await receipts.findOne({projectId:valid.projectId,creatorTurnId:valid.creatorTurnId},{session});
  if(existing)throw Error('turn-already-settled');
  const receipt={projectId:valid.projectId,operationId:valid.operationId,creatorTurnId:valid.creatorTurnId,serverCommitId:'commit-'+valid.operationId,committedRevision:project.revision+1};
  const updated=await projects.updateOne({_id:valid.projectId,revision:valid.expectedRevision,ownerId},{$inc:{revision:1},$push:{conversation:{$each:[valid.creatorMessage,valid.mentorMessage]}}},{session});
  if(updated.modifiedCount!==1)throw Error('concurrent-writer-denied');
  await receipts.insertOne(receipt,{session});
  return receipt;
 },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'}});
 }finally{await session.endSession()}
}
try{
 await assert.rejects(()=>settle(base,'intruder'),/owner-denied/);
 assert.equal((await projects.findOne({_id:base.projectId})).revision,0);
 console.log('GREEN PHYSICAL_CONVERSATION_UNAUTHORIZED_SETTLEMENT_DENIED');
 const first=await settle(base);
 assert.equal(classifySettlementOutcome({receipt:first,operationId:base.operationId,creatorTurnId:base.creatorTurnId}).retirePending,true);
 let state=await projects.findOne({_id:base.projectId});
 assert.equal(state.revision,1);assert.equal(state.conversation.length,2);
 assert.deepEqual(state.conversation.map(x=>x.role),['creator','mentor']);
 console.log('GREEN PHYSICAL_CONVERSATION_ATOMIC_TWO_MESSAGE_COMMIT');
 const replay=await settle(base);assert.equal(replay.serverCommitId,first.serverCommitId);
 state=await projects.findOne({_id:base.projectId});assert.equal(state.conversation.length,2);assert.equal(await receipts.countDocuments({}),1);
 console.log('GREEN PHYSICAL_CONVERSATION_REPLAY_EXACTLY_ONCE');
 await assert.rejects(()=>settle({...base,operationId:'other-operation'}),/stale-revision/);
 await assert.rejects(()=>settle({...base,operationId:'other-operation',expectedRevision:1}),/turn-already-settled/);
 console.log('GREEN PHYSICAL_CONVERSATION_STALE_AND_DUPLICATE_TURN_DENIED');
 const contender=i=>({...base,operationId:'operation-'+i,creatorTurnId:'turn-'+i,expectedRevision:1,creatorMessage:{id:'turn-'+i,role:'creator',text:'Scene '+i},mentorMessage:{id:'mentor-'+i,role:'mentor',text:'Response '+i,metadata:{backendMetadata:{creatorTurnId:'turn-'+i}}}});
 const outcomes=await Promise.allSettled([settle(contender(2)),settle(contender(3))]);
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
 state=await projects.findOne({_id:base.projectId});assert.equal(state.revision,2);assert.equal(state.conversation.length,4);assert.equal(await receipts.countDocuments({}),2);
 console.log('GREEN PHYSICAL_CONVERSATION_CONCURRENT_WRITERS_ONE_WINNER');
 const fresh=new MongoClient(process.env.MONGO_URI);await fresh.connect();
 try{const reopened=await fresh.db('isolated_conversation_settlement_court').collection('projects').findOne({_id:base.projectId});assert.equal(reopened.revision,2);assert.equal(reopened.conversation.length,4);const historical=await fresh.db('isolated_conversation_settlement_court').collection('receipts').findOne({operationId:base.operationId});assert.equal(historical.serverCommitId,first.serverCommitId)}finally{await fresh.close()}
 console.log('GREEN PHYSICAL_CONVERSATION_FRESH_CLIENT_DURABLE_READBACK');
 console.log('HELD REAL_STUDIO_UI_AND_PROCESS_KILL_RECOVERY');
}finally{await client.close()}
