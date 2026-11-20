import assert from 'node:assert/strict';
import {MongoClient} from 'mongodb';
import {createPublicKey} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createIsolatedMongoCreatorAuthority} from './isolated-mongo-creator-authority-adapter.mjs';
const {continueCreatorMemoryWithDurableAuthority}=await import(pathToFileURL(resolve('../frontend/src/components/studio/mentor/MovieMentorDurableCreatorWriteBoundary.js')).href);
const client=new MongoClient(process.env.MONGO_URI,{serverSelectionTimeoutMS:12000});
await client.connect();
try{
 const db=client.db('movie_mentor_fresh_process_bridge_isolated');
 const authority=createIsolatedMongoCreatorAuthority({db,client,publicKey:createPublicKey(process.env.PUBLIC_KEY_PEM),issuer:'https://isolated-auth.test',audience:'movie-mentor-creator-write'});
 const projectId='fresh-process-film',operationId='creator-turn-2';
 const proposedState={projects:[{id:projectId,continued:true}],durablePublicationOutbox:[]};
 const base={projectId,operationId,expectedRevision:1,authenticatedSession:process.env.OWNER_TOKEN,proposedState,authorityAdapter:authority};
 if(process.argv[2]==='seed'){
  await authority.operations.deleteMany({projectId});
  await authority.states.deleteMany({projectId});
  await authority.states.insertOne({projectId,ownerId:'owner-1',ownershipRevision:1,revoked:false,revision:1,state:{projects:[{id:projectId}],durablePublicationOutbox:[]}});
  const result=await continueCreatorMemoryWithDurableAuthority(base);
  assert.equal(result.acquired,true,JSON.stringify(result));
  assert.equal(result.committedRevision,2);
  console.log('GREEN PROCESS_ONE_DURABLE_COMMIT');
 }else if(process.argv[2]==='replay'){
  const replay=await continueCreatorMemoryWithDurableAuthority(base);
  assert.equal(replay.acquired,true,JSON.stringify(replay));
  assert.equal(replay.committedRevision,2);
  assert.equal(await authority.operations.countDocuments({projectId}),1);
  console.log('GREEN PROCESS_TWO_DURABLE_REPLAY');
 }else if(process.argv[2]==='deny'){
  const intruder=await continueCreatorMemoryWithDurableAuthority({...base,authenticatedSession:process.env.INTRUDER_TOKEN,operationId:'intruder',expectedRevision:2});
  assert.equal(intruder.acquired,false);
  const stale=await continueCreatorMemoryWithDurableAuthority({...base,operationId:'stale'});
  assert.equal(stale.acquired,false);
  const tampered=await continueCreatorMemoryWithDurableAuthority({...base,operationId:'tampered',expectedRevision:2,proposedState:{...proposedState,durablePublicationOutbox:[{forged:true}]}});
  assert.equal(tampered.acquired,false);
  await authority.states.updateOne({projectId},{$set:{revoked:true}});
  const revoked=await continueCreatorMemoryWithDurableAuthority({...base,operationId:'revoked',expectedRevision:2});
  assert.equal(revoked.acquired,false);
  assert.equal(await authority.operations.countDocuments({projectId}),1);
  console.log('GREEN PROCESS_THREE_UNAUTHORIZED_STALE_OUTBOX_REVOCATION_DENIAL');
  console.log('HELD REAL_CREATOR_MEMORY_FACADE_WRITER_NOT_WIRED');
 }else throw Error('unknown phase');
}finally{await client.close();}
