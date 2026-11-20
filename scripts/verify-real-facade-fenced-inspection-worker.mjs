import assert from 'node:assert/strict';
import {MongoClient} from 'mongodb';
import {createPublicKey} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createProvenanceAuthority} from './isolated-server-publication-provenance.mjs';
import {createWritableAdmissionGate} from './isolated-writable-admission-gate.mjs';
import {inspectFencedRealFacade} from './isolated-real-facade-fenced-admission-inspection.mjs';
const {createCreatorMemory,createMemoryStorageAdapter}=await import(pathToFileURL(resolve('../frontend/src/components/studio/mentor/CreatorMemory.js')).href);
const client=new MongoClient(process.env.MONGO_URI,{serverSelectionTimeoutMS:12000});await client.connect();
try{
 const db=client.db('real_facade_fenced_inspection'),key=createPublicKey(process.env.PUBLIC_KEY_PEM),authority=createProvenanceAuthority({db,client,publicKey:key}),gate=createWritableAdmissionGate({db,client,publicKey:key});
 const projectId='real-facade-fenced-inspection',token=process.env.OWNER_TOKEN,phase=process.argv[2];
 const storage=createMemoryStorageAdapter(),facade=createCreatorMemory({storageAdapter:storage,requireSharedWriteAuthority:true});
 const baseline=JSON.stringify(facade.getState());
 if(phase==='seed'){
  await authority.states.deleteMany({projectId});await authority.ledger.deleteMany({projectId});await authority.grants.deleteMany({projectId});await gate.admissions.deleteMany({projectId});
  await authority.states.insertOne({projectId,ownerId:'owner-1',ownershipRevision:1,revoked:false,revision:1,state:{...facade.getState(),durablePublicationOutbox:[]}});
  assert.equal((await authority.append({token,projectId,operationId:'publish-1',expectedRevision:1,content:'scene-two'})).ok,true);
  const grant=await authority.issue({token,projectId,revision:2});assert.ok(grant);
  const admitted=await gate.admit({token,projectId,grantId:grant.grantId,operationId:'real-facade-admission-1',revision:2});
  assert.equal(admitted.acquired,true);
  console.log('GREEN SERVER_FENCED_ADMISSION_PREPARED_FOR_REAL_FACADE');
 }else if(phase==='restart'){
  const receipt=await gate.admissions.findOne({projectId});assert.ok(receipt);
  const input={facade,gate,token,projectId,operationId:receipt.operationId,fence:receipt.fence};
  const result=await inspectFencedRealFacade(input);
  assert.equal(result.acquired,true);assert.equal(result.localStateAdopted,false);assert.equal(result.writable,false);
  assert.equal(result.state.durablePublicationOutbox.length,1);
  assert.equal(JSON.stringify(facade.getState()),baseline);
  const intruder=await inspectFencedRealFacade({...input,token:process.env.INTRUDER_TOKEN});assert.equal(intruder.acquired,false);
  const forged=await inspectFencedRealFacade({...input,fence:'forged'});assert.equal(forged.acquired,false);
  assert.equal(JSON.stringify(facade.getState()),baseline);
  console.log('GREEN REAL_FACADE_FENCED_CANONICAL_READBACK_NO_LOCAL_ADOPTION');
  console.log('GREEN REAL_FACADE_INTRUDER_AND_FORGED_FENCE_DENIED');
  await gate.ledger.updateOne({projectId},{$set:{'entry.snapshotDigest':'tampered'}});
  assert.equal((await inspectFencedRealFacade(input)).acquired,false);
  assert.equal(JSON.stringify(facade.getState()),baseline);
  console.log('GREEN REAL_FACADE_POST_ADMISSION_LEDGER_TAMPER_DENIED');
  console.log('HELD REAL_FACADE_WRITABLE_ADOPTION_AND_ORIGINAL_FRONTEND_RED');
 }else throw Error('unknown phase');
}finally{await client.close()}
