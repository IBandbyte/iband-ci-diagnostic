import assert from 'node:assert/strict';
import {MongoClient} from 'mongodb';
import {createPublicKey} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createIsolatedMongoCreatorAuthority} from './isolated-mongo-creator-authority-adapter.mjs';
const {createCreatorMemory,createMemoryStorageAdapter}=await import(pathToFileURL(resolve('../frontend/src/components/studio/mentor/CreatorMemory.js')).href);
const client=new MongoClient(process.env.MONGO_URI,{serverSelectionTimeoutMS:12000});
await client.connect();
try{
 const db=client.db('movie_mentor_real_facade_bridge_isolated');
 const authority=createIsolatedMongoCreatorAuthority({db,client,publicKey:createPublicKey(process.env.PUBLIC_KEY_PEM),issuer:'https://isolated-auth.test',audience:'movie-mentor-creator-write'});
 const projectId='real-facade-film',operationId='creator-turn-2';
 const storage=createMemoryStorageAdapter();
 const facade=createCreatorMemory({storageAdapter:storage,requireSharedWriteAuthority:true});
 const before=JSON.stringify(facade.getState());
 const proposedState={...facade.getState(),journey:{...facade.getState().journey,activeProjectId:projectId},durablePublicationOutbox:[]};
 const request={projectId,operationId,expectedRevision:1,authenticatedSession:process.env.OWNER_TOKEN,proposedState,authorityAdapter:authority};
 if(process.argv[2]==='seed'){
  await authority.operations.deleteMany({projectId});
  await authority.states.deleteMany({projectId});
  await authority.states.insertOne({projectId,ownerId:'owner-1',ownershipRevision:1,revoked:false,revision:1,state:{...facade.getState(),durablePublicationOutbox:[]}});
  const result=await facade.continueWithDurableServerAuthority(request);
  assert.equal(result.acquired,true,JSON.stringify(result));
  assert.equal(result.localStateAdopted,false);
  assert.equal(JSON.stringify(facade.getState()),before);
  assert.equal(await authority.operations.countDocuments({projectId}),1);
  console.log('GREEN REAL_FACADE_PROCESS_ONE_PHYSICAL_MONGO_COMMIT');
 }else if(process.argv[2]==='replay'){
  const result=await facade.continueWithDurableServerAuthority(request);
  // The initial process' default state has different timestamps; a replay
  // must present exactly the original proposal. Read the durable operation
  // and reuse the original immutable proposedState for this negative check.
  assert.equal(result.acquired,false,'A distinct payload with same operation ID must be rejected');
  const committed=await authority.operations.findOne({projectId,operationId});
  assert.ok(committed);
  const matching=await facade.continueWithDurableServerAuthority({...request,proposedState:committed.state});
  assert.equal(matching.acquired,true,JSON.stringify(matching));
  assert.equal(matching.localStateAdopted,false);
  assert.equal(JSON.stringify(facade.getState()),before);
  assert.equal(await authority.operations.countDocuments({projectId}),1);
  console.log('GREEN REAL_FACADE_PROCESS_TWO_DURABLE_REPLAY_AND_CONFLICT_DENIAL');
 }else if(process.argv[2]==='deny'){
  const intruder=await facade.continueWithDurableServerAuthority({...request,authenticatedSession:process.env.INTRUDER_TOKEN,operationId:'intruder',expectedRevision:2});
  assert.equal(intruder.acquired,false);
  const stale=await facade.continueWithDurableServerAuthority({...request,operationId:'stale'});
  assert.equal(stale.acquired,false);
  const forged=await facade.continueWithDurableServerAuthority({...request,operationId:'forged',expectedRevision:2,proposedState:{...proposedState,durablePublicationOutbox:[{forged:true}]}});
  assert.equal(forged.acquired,false);
  await authority.states.updateOne({projectId},{$set:{revoked:true}});
  const revoked=await facade.continueWithDurableServerAuthority({...request,operationId:'revoked',expectedRevision:2});
  assert.equal(revoked.acquired,false);
  assert.equal(JSON.stringify(facade.getState()),before);
  assert.equal(await authority.operations.countDocuments({projectId}),1);
  console.log('GREEN REAL_FACADE_PROCESS_THREE_UNAUTHORIZED_DENIAL');
  console.log('HELD LOCAL_STATE_ADOPTION_AND_ORIGINAL_CONTINUITY_RED');
 }else throw Error('unknown phase');
}finally{await client.close();}
