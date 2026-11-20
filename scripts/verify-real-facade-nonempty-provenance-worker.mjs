import assert from 'node:assert/strict';
import {MongoClient} from 'mongodb';
import {createPublicKey} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createProvenanceAuthority} from './isolated-server-publication-provenance.mjs';
import {createReadOnlyProvenanceBridge} from './isolated-real-facade-provenance-readonly-bridge.mjs';
const {createCreatorMemory,createMemoryStorageAdapter}=await import(pathToFileURL(resolve('../frontend/src/components/studio/mentor/CreatorMemory.js')).href);
const client=new MongoClient(process.env.MONGO_URI,{serverSelectionTimeoutMS:12000});await client.connect();
try{
 const db=client.db('real_facade_provenance_bridge_court'),publicKey=createPublicKey(process.env.PUBLIC_KEY_PEM);
 const authority=createProvenanceAuthority({db,client,publicKey});
 const bridge=createReadOnlyProvenanceBridge({db,client,publicKey});
 const projectId='real-facade-nonempty-film',token=process.env.OWNER_TOKEN;
 const facade=createCreatorMemory({storageAdapter:createMemoryStorageAdapter(),requireSharedWriteAuthority:true});
 const before=JSON.stringify(facade.getState()),phase=process.argv[2];
 if(phase==='seed'){
  await authority.states.deleteMany({projectId});await authority.ledger.deleteMany({projectId});await authority.grants.deleteMany({projectId});await bridge.operations.deleteMany({projectId});
  await authority.states.insertOne({projectId,ownerId:'owner-1',ownershipRevision:1,revoked:false,revision:1,state:{...facade.getState(),durablePublicationOutbox:[]}});
  const a=await authority.append({token,projectId,operationId:'server-publication-1',expectedRevision:1,content:'scene-two'});
  assert.equal(a.ok,true);
  const state=(await authority.states.findOne({projectId})).state;
  assert.equal(state.durablePublicationOutbox.length,1);
  const result=await facade.continueWithDurableServerAuthority({projectId,operationId:'real-facade-continuation-1',expectedRevision:2,authenticatedSession:token,proposedState:state,authorityAdapter:bridge});
  assert.equal(result.acquired,true,JSON.stringify(result));assert.equal(result.localStateAdopted,false);assert.equal(result.restorationMode,'server-read-only');
  assert.equal(JSON.stringify(facade.getState()),before);
  console.log('GREEN REAL_FACADE_NONEMPTY_SERVER_PROVENANCE_READ_ONLY_COMMIT');
 }else if(phase==='restart'){
  const state=(await authority.states.findOne({projectId})).state;
  const request={projectId,operationId:'real-facade-continuation-1',expectedRevision:2,authenticatedSession:token,proposedState:state,authorityAdapter:bridge};
  const replay=await facade.continueWithDurableServerAuthority(request);
  assert.equal(replay.acquired,true,JSON.stringify(replay));assert.equal(replay.localStateAdopted,false);
  assert.equal(JSON.stringify(facade.getState()),before);
  assert.equal(await bridge.operations.countDocuments({projectId}),1);
  console.log('GREEN FRESH_PROCESS_REAL_FACADE_NONEMPTY_REPLAY_WITHOUT_LOCAL_ADOPTION');
 }else if(phase==='deny'){
  const state=(await authority.states.findOne({projectId})).state;
  const base={projectId,expectedRevision:2,proposedState:state,authorityAdapter:bridge};
  const intruder=await facade.continueWithDurableServerAuthority({...base,operationId:'intruder',authenticatedSession:process.env.INTRUDER_TOKEN});
  assert.equal(intruder.acquired,false);
  const forged=await facade.continueWithDurableServerAuthority({...base,operationId:'forged',authenticatedSession:token,proposedState:{...state,durablePublicationOutbox:[{forged:true}]}});
  assert.equal(forged.acquired,false);
  await authority.states.updateOne({projectId},{$set:{'state.durablePublicationOutbox.0.snapshotDigest':'f'.repeat(64)}});
  const tampered=await facade.continueWithDurableServerAuthority({...base,operationId:'tampered',authenticatedSession:token,proposedState:(await authority.states.findOne({projectId})).state});
  assert.equal(tampered.acquired,false);
  assert.equal(JSON.stringify(facade.getState()),before);
  console.log('GREEN REAL_FACADE_INTRUDER_FORGED_AND_TAMPERED_PROVENANCE_DENIED');
  console.log('HELD WRITABLE_ADOPTION_AND_ORIGINAL_FRONTEND_CONTINUITY_RED');
 }else throw Error('unknown phase');
}finally{await client.close()}
