// Physical source-exact CreatorMemory writable continuation through server-fenced
// admission. New scenes must be committed by Mongo; local facade stays read-only.
import assert from 'node:assert/strict';
import {MongoClient} from 'mongodb';
import {createPublicKey} from 'node:crypto';
import {createProvenanceAuthority} from './isolated-server-publication-provenance.mjs';
import {createWritableAdmissionGate} from './isolated-writable-admission-gate.mjs';
import {createServerOwnedEditor} from './isolated-server-owned-positive-editor.mjs';
import {createFrontendContinuationCompatibility} from './isolated-frontend-continuation-compatibility.mjs';
import createCreatorMemory,{createMemoryStorageAdapter} from '../frontend/src/components/studio/mentor/CreatorMemory.js';

const phase=process.argv[2],projectId='pinned-real-facade-writable-adoption',admissionId='adopt1';
assert.ok(['seed','first','second','restart','revoke'].includes(phase));
const client=new MongoClient(process.env.MONGO_URI,{serverSelectionTimeoutMS:12000});
await client.connect();
const db=client.db('isolated_real_facade_writable_adoption');
const key=createPublicKey(process.env.PUBLIC_KEY_PEM);
const provenance=createProvenanceAuthority({db,client,publicKey:key});
const gate=createWritableAdmissionGate({db,client,publicKey:key});
const editor=createServerOwnedEditor({gate,db,client,publicKey:key});
const local=createMemoryStorageAdapter();
const facade=createCreatorMemory({storageAdapter:local,requireSharedWriteAuthority:true});
const initialLocalBytes=local.getItem('iband.creator-memory');
const initialView=JSON.stringify(facade.getState());
const token=process.env.OWNER_TOKEN,lock={request:async(n,options,cb)=>cb({name:n,mode:'exclusive'})};
async function unchanged(){
 assert.equal(local.getItem('iband.creator-memory'),initialLocalBytes,'server-owned write cannot touch local persisted bytes');
 assert.equal(JSON.stringify(facade.getState()),initialView,'server-owned write cannot silently rebase the local facade');
}
const session={serverVerified:true};
async function through({token:accessToken=token,fence,operationId,expectedRevision,content}){
 const record=await gate.states.findOne({projectId});
 const proposedState={...record.state,content};
 const adapter=createFrontendContinuationCompatibility({gate,editor,token:accessToken,projectId,admissionOperationId:admissionId,fence});
 return facade.continueWithDurableServerAuthority({projectId,operationId,expectedRevision,authenticatedSession:session,proposedState,authorityAdapter:adapter});
}
try{
 if(phase==='seed'){
  for(const collection of [provenance.states,provenance.ledger,provenance.grants,gate.admissions,editor.edits])await collection.deleteMany({projectId});
  await provenance.ledger.createIndex({projectId:1,operationId:1},{unique:true});
  await gate.admissions.createIndex({projectId:1,operationId:1},{unique:true});
  await editor.edits.createIndex({projectId:1,operationId:1},{unique:true});
  await provenance.states.insertOne({projectId,ownerId:'owner-1',ownershipRevision:1,revoked:false,revision:0,state:{...facade.getState(),content:'initial scene',durablePublicationOutbox:[]}});
  assert.equal((await provenance.append({token,projectId,operationId:'seed-publication',expectedRevision:0,content:'confirmed opening'})).ok,true);
  const grant=await provenance.issue({token,projectId,revision:1});assert.ok(grant?.grantId);
  const admission=await gate.admit({token,projectId,grantId:grant.grantId,operationId:admissionId,revision:1});
  assert.equal(admission.acquired,true);
  assert.equal((await gate.readAdmission({token,projectId,operationId:admissionId,fence:admission.fence}))?.revision,1);
  await unchanged();
  console.log('GREEN PINNED_CREATOR_MEMORY_SERVER_WRITABLE_ADMISSION_GRANTED');
 }else{
  const admitted=await gate.admissions.findOne({projectId,operationId:admissionId});
  assert.ok(admitted?.fence);
  const fence=admitted.fence;
  if(phase==='first'||phase==='second'){
   const second=phase==='second',revision=second?2:1;
   const data=second?'creator-approved-third-scene':'creator-approved-second-scene';
   const result=await through({fence,operationId:admissionId+':edit'+(second?'2':'1'),expectedRevision:revision,content:data});
   assert.equal(result.acquired,true,JSON.stringify(result));
   assert.equal(result.committedRevision,revision+1);
   assert.equal(result.restorationMode,'server-read-only');
   assert.equal(result.localStateAdopted,false);
   assert.equal(result.state.content,data);
   assert.equal((await gate.states.findOne({projectId})).revision,revision+1);
   assert.equal(await editor.edits.countDocuments({projectId}),second?2:1);
   await unchanged();
   console.log(second?'GREEN PINNED_CREATOR_MEMORY_SECOND_FENCED_NEXT_SCENE':'GREEN PINNED_CREATOR_MEMORY_FIRST_FENCED_NEXT_SCENE');
  }else if(phase==='restart'){
   const snapshot=await gate.states.findOne({projectId});
   assert.equal(snapshot.revision,3);
   const adapter=createFrontendContinuationCompatibility({gate,editor,token,projectId,admissionOperationId:admissionId,fence});
   for(const [operationId,revision,data] of [[admissionId+':edit1',1,'creator-approved-second-scene'],[admissionId+':edit2',2,'creator-approved-third-scene']]){
    const proposedState={...snapshot.state,content:data};
    const prior=await editor.edits.findOne({projectId,operationId});
    assert.ok(prior?.committedState);
    const result=await facade.continueWithDurableServerAuthority({projectId,operationId,expectedRevision:revision,authenticatedSession:session,proposedState:prior.committedState,authorityAdapter:adapter});
    assert.equal(result.acquired,true,JSON.stringify(result));
    assert.equal(result.committedRevision,revision+1);
    await unchanged();
   }
   const intruder=await through({token:process.env.INTRUDER_TOKEN,fence,operationId:admissionId+':intruder',expectedRevision:3,content:'intruder'});
   assert.equal(intruder.acquired,false);
   const forged=await through({fence:'forged',operationId:admissionId+':forged',expectedRevision:3,content:'forged'});
   assert.equal(forged.acquired,false);
   const stale=await through({fence,operationId:admissionId+':stale',expectedRevision:1,content:'stale'});
   assert.equal(stale.acquired,false);
   assert.equal(await editor.edits.countDocuments({projectId}),2);
   await unchanged();
   console.log('GREEN PINNED_CREATOR_MEMORY_FRESH_PROCESS_REPLAY_AND_INTRUDER_FORGERY_STALE_DENIAL');
  }else{
   await gate.states.updateOne({projectId,revoked:false},{$set:{revoked:true}});
   const denied=await through({fence,operationId:admissionId+':revoked',expectedRevision:3,content:'revoked'});
   assert.equal(denied.acquired,false);
   const adapter=createFrontendContinuationCompatibility({gate,editor,token,projectId,admissionOperationId:admissionId,fence});
   assert.equal(await adapter.readCommitted({authenticatedSession:session,projectId,operationId:admissionId+':edit2'}),null);
   assert.equal((await gate.states.findOne({projectId})).revision,3);
   assert.equal(await editor.edits.countDocuments({projectId}),2);
   await unchanged();
   console.log('GREEN PINNED_CREATOR_MEMORY_REVOKED_PUBLICATION_EDIT_AND_REPLAY_DENIED');
   console.log('HELD ORIGINAL_FRONTEND_RED_AND_APPLICATION_WRITABLE_ADOPTION');
  }
 }
}finally{await client.close();}
