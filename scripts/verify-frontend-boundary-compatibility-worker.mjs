import assert from 'node:assert/strict';
import {MongoClient} from 'mongodb';
import {createPublicKey} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createProvenanceAuthority} from './isolated-server-publication-provenance.mjs';
import {createWritableAdmissionGate} from './isolated-writable-admission-gate.mjs';
import {createServerOwnedEditor} from './isolated-server-owned-positive-editor.mjs';
import {createFrontendContinuationCompatibility} from './isolated-frontend-continuation-compatibility.mjs';
import {continueCreatorMemoryWithDurableAuthority} from '../frontend/src/components/studio/mentor/MovieMentorDurableCreatorWriteBoundary.js';
const {createCreatorMemory,createMemoryStorageAdapter}=await import(pathToFileURL(resolve('../frontend/src/components/studio/mentor/CreatorMemory.js')).href);
const client=new MongoClient(process.env.MONGO_URI,{serverSelectionTimeoutMS:12000});await client.connect();
try{
 const db=client.db('frontend_boundary_compatibility_court'),key=createPublicKey(process.env.PUBLIC_KEY_PEM),authority=createProvenanceAuthority({db,client,publicKey:key}),gate=createWritableAdmissionGate({db,client,publicKey:key}),editor=createServerOwnedEditor({gate,db,client,publicKey:key});
 const projectId='frontend-boundary-compatibility',token=process.env.OWNER_TOKEN,phase=process.argv[2];
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
  const adapter=createFrontendContinuationCompatibility({gate,editor,token,projectId,admissionOperationId:'admit1',fence:admission.fence});
  const second=phase==='second';
  const proposedState={...(await gate.states.findOne({projectId})).state,content:(second||phase==='restart')?'creator-approved-scene-four':'creator-approved-scene-three'};
  if(phase==='restart'){
   const previous={...proposedState,content:'creator-approved-scene-three'};
   const old=await continueCreatorMemoryWithDurableAuthority({projectId,operationId:'admit1:edit1',expectedRevision:2,authenticatedSession:{serverVerified:true},proposedState:previous,authorityAdapter:adapter});
   if(!old.acquired){
    const receipt=await editor.edits.findOne({projectId,operationId:'admit1:edit1'});
    const direct=await editor.edit({token,projectId,operationId:'admit1:edit1',fence:admission.fence,expectedRevision:2,content:'creator-approved-scene-three'});
    const directRead=await adapter.readCommitted({authenticatedSession:{serverVerified:true},projectId,operationId:'admit1:edit1'});
    console.log('DIAGNOSTIC_HISTORICAL_REPLAY',JSON.stringify({boundaryReason:old.reason,receiptPresent:!!receipt,receiptHasCommittedState:!!receipt?.committedState,directEdit:direct,directReadPresent:!!directRead,canonicalRevision:(await gate.states.findOne({projectId})).revision}));
   }
   assert.equal(old.acquired,true,JSON.stringify(old));
   assert.equal(old.committedRevision,3);
   const latest=await continueCreatorMemoryWithDurableAuthority({projectId,operationId:'admit1:edit2',expectedRevision:3,authenticatedSession:{serverVerified:true},proposedState,authorityAdapter:adapter});
   assert.equal(latest.acquired,true,JSON.stringify(latest));
   assert.equal(latest.committedRevision,4);
   assert.equal((await gate.states.findOne({projectId})).revision,4);
   assert.equal(await editor.edits.countDocuments({projectId}),2);
   console.log('GREEN PINNED_FRONTEND_BOUNDARY_HISTORICAL_AND_CURRENT_READBACK');
   const intruder=createFrontendContinuationCompatibility({gate,editor,token:process.env.INTRUDER_TOKEN,projectId,admissionOperationId:'admit1',fence:admission.fence});
   assert.equal((await continueCreatorMemoryWithDurableAuthority({projectId,operationId:'admit1:intruder',expectedRevision:4,authenticatedSession:{serverVerified:true},proposedState,authorityAdapter:intruder})).acquired,false);
   const forged=createFrontendContinuationCompatibility({gate,editor,token,projectId,admissionOperationId:'admit1',fence:'forged'});
   assert.equal((await continueCreatorMemoryWithDurableAuthority({projectId,operationId:'admit1:forged',expectedRevision:4,authenticatedSession:{serverVerified:true},proposedState,authorityAdapter:forged})).acquired,false);
   console.log('GREEN PINNED_FRONTEND_BOUNDARY_INTRUDER_AND_FORGED_DENIED');
   console.log('HELD ORIGINAL_FRONTEND_RED_AND_REAL_UI_INTEGRATION');
  }else{
   const result=await continueCreatorMemoryWithDurableAuthority({projectId,operationId:second?'admit1:edit2':'admit1:edit1',expectedRevision:second?3:2,authenticatedSession:{serverVerified:true},proposedState,authorityAdapter:adapter});
   assert.equal(result.acquired,true,JSON.stringify(result));
   assert.equal(result.committedRevision,second?4:3);
   assert.equal(JSON.stringify(facade.getState()),baseline);
   console.log(second?'GREEN PINNED_FRONTEND_BOUNDARY_SECOND_EDIT':'GREEN PINNED_FRONTEND_BOUNDARY_FIRST_EDIT');
  }
 }else throw Error('unknown phase');
}finally{await client.close()}
