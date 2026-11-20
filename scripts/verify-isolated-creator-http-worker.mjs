import assert from 'node:assert/strict';
import {MongoClient} from 'mongodb';
import {createPublicKey} from 'node:crypto';
import {createWritableAdmissionGate} from './isolated-writable-admission-gate.mjs';
import {createServerOwnedEditor} from './isolated-server-owned-positive-editor.mjs';
import {createIsolatedCreatorHttpServer} from './isolated-creator-http-transport.mjs';
const client=new MongoClient(process.env.MONGO_URI,{serverSelectionTimeoutMS:12000});await client.connect();
const projectId='frontend-boundary-compatibility',db=client.db('frontend_boundary_compatibility_court'),publicKey=createPublicKey(process.env.PUBLIC_KEY_PEM),gate=createWritableAdmissionGate({db,client,publicKey}),editor=createServerOwnedEditor({gate,db,client,publicKey});
const server=createIsolatedCreatorHttpServer({gate,editor,projectId,admissionOperationId:'admit1'});
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+server.address().port;
 const request=async(path,token,body)=>{const r=await fetch(url+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()}};
 const owner=process.env.OWNER_TOKEN,intruder=process.env.INTRUDER_TOKEN,phase=process.argv[2];
 const canonical=await gate.states.findOne({projectId});assert.ok(canonical);
 const commit=(token,operationId,expectedRevision,proposedState)=>request('/creator/commit',token,{projectId,operationId,expectedRevision,proposedState});
 const read=(token,operationId)=>request('/creator/read-committed',token,{projectId,operationId});
 if(phase==='first'||phase==='second'){
  const second=phase==='second',operationId=second?'admit1:edit2':'admit1:edit1',expectedRevision=second?3:2,proposedState={...canonical.state,content:second?'creator-approved-scene-four':'creator-approved-scene-three'};
  const result=await commit(owner,operationId,expectedRevision,proposedState);assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.data.committedRevision,expectedRevision+1);
  const receipt=await read(owner,operationId);assert.equal(receipt.status,200);assert.deepEqual(receipt.data.state,proposedState);assert.equal(receipt.data.serverCommitId,result.data.serverCommitId);
  console.log(second?'GREEN HTTP_SECOND_EDIT_AND_AUTHENTICATED_READBACK':'GREEN HTTP_FIRST_EDIT_AND_AUTHENTICATED_READBACK');
 }else if(phase==='restart'){
  const state=canonical.state;
  for(const [id,revision,content] of [['admit1:edit1',3,'creator-approved-scene-three'],['admit1:edit2',4,'creator-approved-scene-four']]){
   const proposedState={...state,content};
   const result=await commit(owner,id,revision-1,proposedState);assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.data.committedRevision,revision);
   const receipt=await read(owner,id);assert.equal(receipt.status,200);assert.deepEqual(receipt.data.state,proposedState);
  }
  assert.equal((await gate.states.findOne({projectId})).revision,4);assert.equal(await editor.edits.countDocuments({projectId}),2);
  console.log('GREEN HTTP_FRESH_PROCESS_HISTORICAL_AND_LATEST_REPLAY');
  const forbidden=await read(intruder,'admit1:edit1');assert.notEqual(forbidden.status,200);
  const denied=await commit(intruder,'admit1:intruder',4,{...state,content:'intruder'});assert.notEqual(denied.status,200);
  const invalid=await commit('invalid','admit1:invalid',4,{...state,content:'invalid'});assert.equal(invalid.status,401);
  const mismatched=await commit(owner,'admit1:edit1',2,{...state,content:'tampered'});assert.notEqual(mismatched.status,200);
  console.log('GREEN HTTP_INTRUDER_INVALID_JWT_AND_TAMPER_DENIED');
 }else if(phase==='revoke'){
  assert.equal(canonical.revision,4);await gate.states.updateOne({_id:canonical._id,revoked:false},{$set:{revoked:true}});
  assert.notEqual((await read(owner,'admit1:edit1')).status,200);
  assert.notEqual((await read(owner,'admit1:edit2')).status,200);
  assert.notEqual((await commit(owner,'admit1:edit3',4,{...canonical.state,content:'forbidden'})).status,200);
  assert.equal((await gate.states.findOne({projectId})).revision,4);assert.equal(await editor.edits.countDocuments({projectId}),2);
  console.log('GREEN HTTP_REVOKED_OWNER_READ_AND_EDIT_DENIED');
  console.log('HELD ORIGINAL_FRONTEND_RED_AND_REAL_UI_INTEGRATION');
 }else throw Error('unknown phase');
}finally{await new Promise(resolve=>server.close(resolve));await client.close()}
