// Isolated physical bridge: real frontend recovered-workspace projection and Mongo publication CAS.
// Does NOT grant CreatorMemory's unwitnessed local writer authority.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {MongoClient} from 'mongodb';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const {projectRecoveredCreatorWorkspace}=await import(pathToFileURL(resolve('../frontend/src/components/studio/mentor/MovieMentorRecoveredWorkspaceProjection.js')).href);
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const client=new MongoClient(process.env.MONGO_URI,{serverSelectionTimeoutMS:12000});
const projectId='isolated-bridge-film';
const seed={projectId,revision:1,creatorStateGeneration:1,projectJourney:{projectId,currentStageId:'story'},creatorConfirmedContext:[{key:'project',value:{id:projectId,title:'Bridge Film',creatorType:'video',metadata:{creatorMode:'ai-movie'}}}],memoryContext:{conversations:[{projectId,role:'creator',content:'First scene'}]}};
await client.connect();
const db=client.db('movie_mentor_frontend_mongo_bridge_isolated');
const states=db.collection('states'),ops=db.collection('operations');
try{
 await states.deleteMany({});await ops.deleteMany({});
 await states.createIndex({projectId:1},{unique:true});
 await ops.createIndex({projectId:1,principalId:1,operationId:1},{unique:true});
 await states.insertOne({projectId,principalId:'owner',ownershipRevision:1,revision:1,state:seed,digest:digest(seed)});
 const read=async()=>{const doc=await states.findOne({projectId});assert.equal(digest(doc.state),doc.digest);return projectRecoveredCreatorWorkspace({projectId,state:doc.state});};
 const before=await read();assert.equal(before.conversationMessages[0].content,'First scene');
 async function commit({principalId='owner',ownershipRevision=1,expectedRevision=1,operationId,body}){
  const session=client.startSession();
  try{return await session.withTransaction(async()=>{
   const current=await states.findOne({projectId},{session});
   if(current.principalId!==principalId||current.ownershipRevision!==ownershipRevision)return {kind:'denied',reason:'ownership'};
   const requestDigest=digest({expectedRevision,body});
   const previous=await ops.findOne({projectId,principalId,operationId},{session});
   if(previous)return previous.requestDigest===requestDigest?{kind:'replay',revision:previous.revision}:{kind:'denied',reason:'operation-conflict'};
   if(current.revision!==expectedRevision)return {kind:'denied',reason:'stale-revision'};
   const next={...current.state,revision:expectedRevision+1,creatorStateGeneration:current.state.creatorStateGeneration+1,memoryContext:{conversations:[...current.state.memoryContext.conversations,body]}};
   projectRecoveredCreatorWorkspace({projectId,state:next});
   const updated=await states.updateOne({projectId,principalId,ownershipRevision,revision:expectedRevision},{$set:{revision:expectedRevision+1,state:next,digest:digest(next)}},{session});
   if(updated.matchedCount!==1)return {kind:'denied',reason:'concurrent-update'};
   await ops.insertOne({projectId,principalId,operationId,requestDigest,revision:expectedRevision+1},{session});
   return {kind:'accepted',revision:expectedRevision+1};
  },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'}});}
  finally{await session.endSession();}
 }
 const message={projectId,role:'creator',content:'Second scene'};
 const request={operationId:'continue-01',body:message};
 assert.equal((await commit({principalId:'intruder',...request})).reason,'ownership');
 assert.equal((await commit(request)).kind,'accepted');
 assert.equal((await commit(request)).kind,'replay');
 assert.equal((await commit({...request,body:{...message,content:'forged'}})).reason,'operation-conflict');
 assert.equal((await commit({...request,operationId:'stale-01'})).reason,'stale-revision');
 const after=await read();assert.equal(after.revision,2);assert.equal(after.conversationMessages.length,2);
 console.log('GREEN PHYSICAL_FRONTEND_PROJECTION_TO_MONGO_CAS');
 // A new Mongo client simulates a fresh database connection, NOT a frontend process restart.
 const fresh=new MongoClient(process.env.MONGO_URI);await fresh.connect();
 try{const persisted=await fresh.db('movie_mentor_frontend_mongo_bridge_isolated').collection('states').findOne({projectId});assert.equal(digest(persisted.state),persisted.digest);assert.equal(projectRecoveredCreatorWorkspace({projectId,state:persisted.state}).conversationMessages[1].content,'Second scene');}
 finally{await fresh.close();}
 console.log('GREEN FRESH_MONGO_CONNECTION_FRONTEND_PROJECTION');
 await states.updateOne({projectId},{$set:{principalId:'new-owner',ownershipRevision:2}});
 const revoked=await states.findOne({projectId});
 assert.equal((await commit({...request,operationId:'revoked',expectedRevision:2})).reason,'ownership');
 assert.deepEqual(await states.findOne({projectId}),revoked);
 assert.equal(await ops.countDocuments({projectId}),1);
 console.log('GREEN PHYSICAL_BRIDGE_OWNER_STALE_REPLAY_REVOCATION');
 console.log('HELD REAL_CREATOR_MEMORY_WRITE_AND_PROCESS_RESTART_NOT_CERTIFIED');
}finally{await client.close();}
