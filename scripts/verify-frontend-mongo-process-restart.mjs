// Separate OS-process Mongo continuation court using real frontend recovery projection.
// Synthetic principal: this is NOT authenticated CreatorMemory writer authorization.
import assert from 'node:assert/strict';
import {MongoClient} from 'mongodb';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const {projectRecoveredCreatorWorkspace}=await import(pathToFileURL(resolve('../frontend/src/components/studio/mentor/MovieMentorRecoveredWorkspaceProjection.js')).href);
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const projectId='physical-process-restart-film';
const principal='creator-owner';
const mode=process.argv[2];
assert.ok(['seed','resume','deny'].includes(mode));
const client=new MongoClient(process.env.MONGO_URI,{serverSelectionTimeoutMS:12000});
await client.connect();
const db=client.db('movie_mentor_frontend_process_restart_isolated');
const states=db.collection('creator_state'),operations=db.collection('operations');
try{
 await states.createIndex({projectId:1},{unique:true});
 await operations.createIndex({projectId:1,operationId:1},{unique:true});
 if(mode==='seed'){
  await states.deleteMany({projectId});await operations.deleteMany({projectId});
  const state={projectId,revision:1,creatorStateGeneration:1,projectJourney:{projectId,currentStageId:'story'},creatorConfirmedContext:[{key:'project',value:{id:projectId,title:'Restart Film',creatorType:'video',metadata:{creatorMode:'ai-movie'}}}],memoryContext:{conversations:[{projectId,role:'creator',content:'Opening scene'}]}};
  await states.insertOne({projectId,principalId:principal,ownershipRevision:1,revision:1,state,digest:hash(state)});
  console.log('GREEN RESTART_SEED_DURABLE');
 }else{
  const initial=await states.findOne({projectId});
  assert.equal(hash(initial.state),initial.digest);
  const projection=projectRecoveredCreatorWorkspace({projectId,state:initial.state});
  assert.equal(projection.conversationMessages[0].content,'Opening scene');
  if(mode==='resume'){
   assert.equal(initial.revision,1);
   const operationId='continue-after-process-restart';
   const message={projectId,role:'creator',content:'Scene two after restart'};
   const requestDigest=hash({expectedRevision:1,message});
   async function commit(){
    const session=client.startSession();
    try{return await session.withTransaction(async()=>{
     const current=await states.findOne({projectId},{session});
     assert.equal(current.principalId,principal);
     const prior=await operations.findOne({projectId,operationId},{session});
     if(prior)return prior.requestDigest===requestDigest?{kind:'replay'}:{kind:'conflict'};
     if(current.revision!==1)return {kind:'stale'};
     const next={...current.state,revision:2,creatorStateGeneration:2,memoryContext:{conversations:[...current.state.memoryContext.conversations,message]}};
     projectRecoveredCreatorWorkspace({projectId,state:next});
     const result=await states.updateOne({projectId,principalId:principal,ownershipRevision:1,revision:1},{$set:{revision:2,state:next,digest:hash(next)}},{session});
     assert.equal(result.matchedCount,1);
     await operations.insertOne({projectId,operationId,requestDigest,revision:2},{session});
     return {kind:'accepted'};
    },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'}});}finally{await session.endSession();}
   }
   assert.equal((await commit()).kind,'accepted');
   assert.equal((await commit()).kind,'replay');
   console.log('GREEN FRESH_PROCESS_MONGO_CONTINUATION_AND_REPLAY');
  }else{
   assert.equal(initial.revision,2);
   assert.equal(projection.conversationMessages.length,2);
   assert.equal(projection.conversationMessages[1].content,'Scene two after restart');
   const unchanged=await states.findOne({projectId});
   // Unauthorized or revoked writers cannot satisfy the ownership-and-revision predicate.
   const attacker=await states.updateOne({projectId,principalId:'attacker',ownershipRevision:1,revision:2},{$set:{revision:999}});
   assert.equal(attacker.matchedCount,0);
   const stale=await states.updateOne({projectId,principalId:principal,ownershipRevision:1,revision:1},{$set:{revision:999}});
   assert.equal(stale.matchedCount,0);
   assert.deepEqual(await states.findOne({projectId}),unchanged);
   assert.equal(await operations.countDocuments({projectId}),1);
   console.log('GREEN SECOND_FRESH_PROCESS_DURABLE_RESTORE_AND_DENIAL');
  }
 }
 console.log('HELD SYNTHETIC_PRINCIPAL_NOT_REAL_CREATOR_MEMORY_WRITER_AUTHORIZATION');
}finally{await client.close();}
