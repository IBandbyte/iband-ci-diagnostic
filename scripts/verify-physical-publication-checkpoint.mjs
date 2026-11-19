// Independent physical Mongo publication checkpoint verifier.
// Isolated database only; NOT production CreatorMemory/HTTP integration.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {MongoClient} from 'mongodb';
const hash=s=>createHash('sha256').update(JSON.stringify(s)).digest('hex');
const client=new MongoClient(process.env.MONGO_URI,{serverSelectionTimeoutMS:12000});
await client.connect();
const db=client.db('movie_mentor_publication_authority_isolated');
const checkpoints=db.collection('publication_checkpoints');
const operations=db.collection('publication_operations');
await checkpoints.deleteMany({});
await operations.deleteMany({});
await checkpoints.createIndex({projectId:1},{unique:true});
await operations.createIndex({projectId:1,principalId:1,operationId:1},{unique:true});
const projectId='isolated-film',owner='creator-one';
await checkpoints.insertOne({projectId,principalId:owner,ownershipRevision:1,revision:0,state:{scene:1},digest:hash({scene:1})});
async function commit({principalId=owner,ownershipRevision=1,expectedRevision=0,operationId,requestDigest,nextState}){
 const session=client.startSession();
 try{return await session.withTransaction(async()=>{
  const current=await checkpoints.findOne({projectId},{session});
  if(!current||current.principalId!==principalId||current.ownershipRevision!==ownershipRevision)return {kind:'denied',reason:'ownership'};
  const prior=await operations.findOne({projectId,principalId,operationId},{session});
  if(prior)return prior.requestDigest===requestDigest?{kind:'replay',revision:prior.revision}:{kind:'denied',reason:'operation-conflict'};
  if(current.revision!==expectedRevision)return {kind:'denied',reason:'stale-revision'};
  const revision=expectedRevision+1;
  const updated=await checkpoints.updateOne({projectId,principalId,ownershipRevision,revision:expectedRevision},{$set:{revision,state:nextState,digest:hash(nextState)}},{session});
  if(updated.matchedCount!==1)return {kind:'denied',reason:'revision-conflict'};
  await operations.insertOne({projectId,principalId,operationId,requestDigest,revision},{session});
  return {kind:'accepted',revision};
 },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'}});}
 finally{await session.endSession();}
}
try{
 const before=await checkpoints.findOne({projectId});
 assert.equal((await commit({principalId:'attacker',operationId:'forged',requestDigest:'a',nextState:{scene:999}})).reason,'ownership');
 assert.deepEqual(await checkpoints.findOne({projectId}),before);
 const op={operationId:'scene-two',requestDigest:'digest-two',nextState:{scene:2}};
 assert.equal((await commit(op)).kind,'accepted');
 assert.equal((await commit(op)).kind,'replay');
 assert.equal((await commit({...op,requestDigest:'changed'})).reason,'operation-conflict');
 assert.equal((await commit({...op,operationId:'stale'})).reason,'stale-revision');
 const restart=await checkpoints.findOne({projectId});
 assert.equal(restart.revision,1);assert.equal(restart.digest,hash({scene:2}));
 assert.equal((await commit({expectedRevision:1,operationId:'scene-three',requestDigest:'digest-three',nextState:{scene:3}})).kind,'accepted');
 assert.equal((await checkpoints.findOne({projectId})).revision,2);
 await checkpoints.updateOne({projectId},{$set:{principalId:'creator-two',ownershipRevision:2}});
 const revoked=await checkpoints.findOne({projectId});
 assert.equal((await commit({expectedRevision:2,operationId:'revoked',requestDigest:'r',nextState:{scene:4}})).reason,'ownership');
 assert.deepEqual(await checkpoints.findOne({projectId}),revoked);
 assert.equal(await operations.countDocuments({projectId}),2);
 console.log('GREEN PHYSICAL_MONGO_PUBLICATION_CHECKPOINT_OWNER_DENIAL');
 console.log('GREEN PHYSICAL_MONGO_PUBLICATION_CHECKPOINT_CAS_AND_RESTART_READ');
 console.log('GREEN PHYSICAL_MONGO_PUBLICATION_CHECKPOINT_REPLAY_AND_CONFLICT');
 console.log('GREEN PHYSICAL_MONGO_PUBLICATION_CHECKPOINT_REVOKED_OWNER_DENIAL');
 console.log('SCOPE isolated Mongo transaction court; NOT production HTTP, CreatorMemory, or real process-restart authorisation');
}finally{await client.close();}
