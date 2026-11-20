import assert from 'node:assert/strict';
import {MongoClient} from 'mongodb';
import {createPublicKey} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createProvenanceAuthority} from './isolated-server-publication-provenance.mjs';
import {createWritableAdmissionGate} from './isolated-writable-admission-gate.mjs';
import {createServerOwnedEditor} from './isolated-server-owned-positive-editor.mjs';
import {createServerOwnedCreatorEditingAdapter} from './isolated-application-facing-server-edit-adapter.mjs';
const {createCreatorMemory,createMemoryStorageAdapter}=await import(pathToFileURL(resolve('../frontend/src/components/studio/mentor/CreatorMemory.js')).href);
const client=new MongoClient(process.env.MONGO_URI,{serverSelectionTimeoutMS:12000});await client.connect();
try{
 const db=client.db('application_facing_adapter_court'),key=createPublicKey(process.env.PUBLIC_KEY_PEM),authority=createProvenanceAuthority({db,client,publicKey:key}),gate=createWritableAdmissionGate({db,client,publicKey:key}),editor=createServerOwnedEditor({gate,db,client,publicKey:key});
 const projectId='application-facing-adapter',token=process.env.OWNER_TOKEN,phase=process.argv[2];
 const facade=createCreatorMemory({storageAdapter:createMemoryStorageAdapter(),requireSharedWriteAuthority:true}),baseline=JSON.stringify(facade.getState());
 if(phase==='seed'){
  for(const coll of [authority.states,authority.ledger,authority.grants,gate.admissions,editor.edits])await coll.deleteMany({projectId});
  await authority.states.insertOne({projectId,ownerId:'owner-1',ownershipRevision:1,revoked:false,revision:1,state:{...facade.getState(),content:'scene-one',durablePublicationOutbox:[]}});
  assert.equal((await authority.append({token,projectId,operationId:'publish-1',expectedRevision:1,content:'scene-two'})).ok,true);
  const grant=await authority.issue({token,projectId,revision:2});assert.ok(grant);
  const admitted=await gate.admit({token,projectId,grantId:grant.grantId,operationId:'admit1',revision:2});assert.equal(admitted.acquired,true);
  console.log('GREEN ADAPTER_SERVER_ADMISSION');
 }else if(['edit','second','restart'].includes(phase)){
  const admission=await gate.admissions.findOne({projectId});assert.ok(admission);
  const second=phase==='second';
  const adapter=createServerOwnedCreatorEditingAdapter({facade,editor,gate,token,projectId,admissionOperationId:'admit1',fence:admission.fence});
  const read=await adapter.read();
  assert.equal(read.ok,true);assert.equal(read.canonicalRevision,phase==='edit'?2:phase==='second'?3:4);
  assert.equal(read.localFacadeWritable,false);assert.equal(read.localStateAdopted,false);
  const input={operationId:second?'admit1:edit2':'admit1:edit1',expectedRevision:second?3:2,content:second?'creator-approved-scene-four':'creator-approved-scene-three'};
  const result=await adapter.edit(input);
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.revision,second?4:3);
  assert.equal(result.canonicalRevision,phase==='restart'?4:(second?4:3));
  assert.equal(result.localStateAdopted,false);assert.equal(result.localFacadeWritable,false);
  assert.equal(result.state.content,phase==='restart'||second?'creator-approved-scene-four':'creator-approved-scene-three');assert.equal(result.state.durablePublicationOutbox.length,1);
  assert.equal(JSON.stringify(facade.getState()),baseline);
  if(phase==='edit'||phase==='second'){
   assert.equal(result.replay,false);
   console.log(second?'GREEN ADAPTER_SECOND_EDIT_AFTER_REOPEN':'GREEN ADAPTER_FIRST_EDIT_NO_LOCAL_PUBLICATION_PROMOTION');
  }else{
   assert.equal(result.replay,true);assert.equal(await editor.edits.countDocuments({projectId}),2);
   assert.equal((await gate.states.findOne({projectId})).revision,4);
   const current=await adapter.edit({operationId:'admit1:edit2',expectedRevision:3,content:'creator-approved-scene-four'});
   assert.equal(current.ok,true);assert.equal(current.replay,true);assert.equal(current.canonicalRevision,4);
   console.log('GREEN ADAPTER_HISTORICAL_AND_CURRENT_REPLAY_LATEST_CANONICAL');
   const intruderAdapter=createServerOwnedCreatorEditingAdapter({facade,editor,gate,token:process.env.INTRUDER_TOKEN,projectId,admissionOperationId:'admit1',fence:admission.fence});
   const intruder=await intruderAdapter.edit({operationId:'admit1:intruder',expectedRevision:4,content:'intruder'});
   assert.equal(intruder.ok,false);
   const forgedAdapter=createServerOwnedCreatorEditingAdapter({facade,editor,gate,token,projectId,admissionOperationId:'admit1',fence:'forged'});
   const forged=await forgedAdapter.edit({operationId:'admit1:forged',expectedRevision:4,content:'forged'});
   assert.equal(forged.ok,false);
   assert.equal(JSON.stringify(facade.getState()),baseline);
   console.log('GREEN ADAPTER_INTRUDER_AND_FORGED_FENCE_DENIED');
   const otherFacade=createCreatorMemory({storageAdapter:createMemoryStorageAdapter(),requireSharedWriteAuthority:true});
   const other=createServerOwnedCreatorEditingAdapter({facade:otherFacade,editor,gate,token,projectId,admissionOperationId:'admit1',fence:admission.fence});
   const competing=await Promise.all([adapter.edit({operationId:'admit1:contender-a',expectedRevision:4,content:'scene-five-a'}),other.edit({operationId:'admit1:contender-b',expectedRevision:4,content:'scene-five-b'})]);
   assert.equal(competing.filter(x=>x.ok&&!x.replay).length,1,JSON.stringify(competing));
   assert.equal(competing.filter(x=>!x.ok).length,1,JSON.stringify(competing));
   const latest=await adapter.read();assert.equal(latest.ok,true);assert.equal(latest.canonicalRevision,5);
   assert.equal(await editor.edits.countDocuments({projectId}),3);
   assert.equal(JSON.stringify(facade.getState()),baseline);
   console.log('GREEN ADAPTER_TWO_FRONTEND_FACADES_ONE_EDIT_WINNER_NO_LOCAL_PROMOTION');
   console.log('HELD REAL_FACADE_LOCAL_WRITABLE_ADOPTION_AND_ORIGINAL_FRONTEND_RED');
  }
 }else throw Error('unknown phase');
}finally{await client.close()}
