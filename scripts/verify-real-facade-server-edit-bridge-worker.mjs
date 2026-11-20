import assert from 'node:assert/strict';
import {MongoClient} from 'mongodb';
import {createPublicKey} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createProvenanceAuthority} from './isolated-server-publication-provenance.mjs';
import {createWritableAdmissionGate} from './isolated-writable-admission-gate.mjs';
import {createServerOwnedEditor} from './isolated-server-owned-positive-editor.mjs';
import {editThroughServerWithRealFacade} from './isolated-real-facade-server-edit-bridge.mjs';
const {createCreatorMemory,createMemoryStorageAdapter}=await import(pathToFileURL(resolve('../frontend/src/components/studio/mentor/CreatorMemory.js')).href);
const client=new MongoClient(process.env.MONGO_URI,{serverSelectionTimeoutMS:12000});await client.connect();
try{
 const db=client.db('real_facade_server_edit_bridge'),key=createPublicKey(process.env.PUBLIC_KEY_PEM),authority=createProvenanceAuthority({db,client,publicKey:key}),gate=createWritableAdmissionGate({db,client,publicKey:key}),editor=createServerOwnedEditor({gate,db,client,publicKey:key});
 const projectId='real-facade-server-edit',token=process.env.OWNER_TOKEN,phase=process.argv[2];
 const facade=createCreatorMemory({storageAdapter:createMemoryStorageAdapter(),requireSharedWriteAuthority:true}),baseline=JSON.stringify(facade.getState());
 if(phase==='seed'){
  for(const coll of [authority.states,authority.ledger,authority.grants,gate.admissions,editor.edits])await coll.deleteMany({projectId});
  await authority.states.insertOne({projectId,ownerId:'owner-1',ownershipRevision:1,revoked:false,revision:1,state:{...facade.getState(),content:'scene-one',durablePublicationOutbox:[]}});
  assert.equal((await authority.append({token,projectId,operationId:'publish-1',expectedRevision:1,content:'scene-two'})).ok,true);
  const grant=await authority.issue({token,projectId,revision:2});assert.ok(grant);
  const admitted=await gate.admit({token,projectId,grantId:grant.grantId,operationId:'admit1',revision:2});assert.equal(admitted.acquired,true);
  console.log('GREEN REAL_FACADE_BRIDGE_SERVER_ADMISSION');
 }else if(phase==='edit'||phase==='restart'){
  const admission=await gate.admissions.findOne({projectId});assert.ok(admission);
  const input={facade,editor,gate,token,projectId,admissionOperationId:'admit1',editOperationId:'admit1:edit1',fence:admission.fence,expectedRevision:2,content:'creator-approved-scene-three'};
  const result=await editThroughServerWithRealFacade(input);
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.revision,3);
  assert.equal(result.localStateAdopted,false);assert.equal(result.localFacadeWritable,false);
  assert.equal(result.state.content,'creator-approved-scene-three');assert.equal(result.state.durablePublicationOutbox.length,1);
  assert.equal(JSON.stringify(facade.getState()),baseline);
  if(phase==='edit'){
   assert.equal(result.replay,false);
   console.log('GREEN REAL_FACADE_SERVER_EDIT_NO_LOCAL_PUBLICATION_PROMOTION');
  }else{
   assert.equal(result.replay,true);assert.equal(await editor.edits.countDocuments({projectId}),1);
   assert.equal((await gate.states.findOne({projectId})).revision,3);
   console.log('GREEN FRESH_PROCESS_REAL_FACADE_BRIDGE_REPLAY');
   const intruder=await editThroughServerWithRealFacade({...input,token:process.env.INTRUDER_TOKEN,editOperationId:'admit1:intruder',expectedRevision:3,content:'intruder'});
   assert.equal(intruder.ok,false);
   const forged=await editThroughServerWithRealFacade({...input,fence:'forged',editOperationId:'admit1:forged',expectedRevision:3,content:'forged'});
   assert.equal(forged.ok,false);
   assert.equal(JSON.stringify(facade.getState()),baseline);
   console.log('GREEN REAL_FACADE_BRIDGE_INTRUDER_AND_FORGED_FENCE_DENIED');
   console.log('HELD REAL_FACADE_LOCAL_WRITABLE_ADOPTION_AND_ORIGINAL_FRONTEND_RED');
  }
 }else throw Error('unknown phase');
}finally{await client.close()}
