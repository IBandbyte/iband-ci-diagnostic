import assert from 'node:assert/strict';
import {MongoClient} from 'mongodb';
import {createPublicKey} from 'node:crypto';
import {createWritableAdmissionGate} from './isolated-writable-admission-gate.mjs';
import {createServerOwnedEditor} from './isolated-server-owned-positive-editor.mjs';
import {createIsolatedCreatorHttpServer} from './isolated-creator-http-transport.mjs';
import {createBrowserCreatorHttpAdapter} from './isolated-browser-creator-http-adapter.mjs';
import {continueCreatorMemoryWithDurableAuthority} from './pinned-frontend-durable-creator-boundary.mjs';
const client=new MongoClient(process.env.MONGO_URI,{serverSelectionTimeoutMS:12000});await client.connect();
const projectId='frontend-boundary-compatibility',db=client.db('frontend_boundary_compatibility_court'),publicKey=createPublicKey(process.env.PUBLIC_KEY_PEM),gate=createWritableAdmissionGate({db,client,publicKey}),editor=createServerOwnedEditor({gate,db,client,publicKey});
const server=createIsolatedCreatorHttpServer({gate,editor,projectId,admissionOperationId:'admit1',afterCommitBeforeReply:({input})=>process.argv[2]==='socket'&&input.operationId==='admit1:socket'});
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
 }else if(phase==='concurrent'){
  assert.equal(canonical.revision,4);
  const a={...canonical.state,content:'race-writer-a'},b={...canonical.state,content:'race-writer-b'};
  const results=await Promise.all([commit(owner,'admit1:raceA',4,a),commit(owner,'admit1:raceB',4,b)]);
  assert.equal(results.filter(r=>r.status===200).length,1,JSON.stringify(results));
  assert.equal(results.filter(r=>r.status!==200).length,1,JSON.stringify(results));
  const winner=results[0].status===200?'admit1:raceA':'admit1:raceB';
  const receipt=await read(owner,winner);assert.equal(receipt.status,200);
  assert.equal(receipt.data.committedRevision,5);
  assert.equal((await gate.states.findOne({projectId})).revision,5);
  assert.equal(await editor.edits.countDocuments({projectId}),3);
  console.log('GREEN HTTP_TWO_CONCURRENT_WRITERS_EXACTLY_ONE_WINNER');
 }else if(phase==='socket'){
  assert.equal(canonical.revision,5);
  const proposedState={...canonical.state,content:'durable-after-lost-http-response'};
  let interrupted=false;
  try{await commit(owner,'admit1:socket',5,proposedState)}catch{interrupted=true}
  assert.equal(interrupted,true,'HTTP response must be lost after durable commit');
  const stored=await gate.states.findOne({projectId});assert.equal(stored.revision,6);
  assert.equal(stored.state.content,proposedState.content);
  assert.equal(await editor.edits.countDocuments({projectId}),4);
  console.log('GREEN HTTP_POST_COMMIT_SOCKET_LOSS_DURABLE_EFFECT');
 }else if(phase==='socket-recover'){
  assert.equal(canonical.revision,6);
  const receipt=await read(owner,'admit1:socket');assert.equal(receipt.status,200,JSON.stringify(receipt));
  assert.equal(receipt.data.committedRevision,6);
  const original=await editor.edits.findOne({projectId,operationId:'admit1:socket'});
  assert.ok(original);
  const replay=await commit(owner,'admit1:socket',5,original.committedState);
  assert.equal(replay.status,200,JSON.stringify(replay));
  assert.equal(replay.data.serverCommitId,receipt.data.serverCommitId);
  assert.equal((await gate.states.findOne({projectId})).revision,6);
  assert.equal(await editor.edits.countDocuments({projectId}),4);
  console.log('GREEN HTTP_FRESH_PROCESS_SAME_OPERATION_REPLAY_NO_DUPLICATE');
 }else if(phase==='browser-physical'){
  assert.equal(canonical.revision,6);
  const {chromium}=await import('playwright');
  const {readFileSync}=await import('node:fs');
  const browser=await chromium.launch({headless:true});
  try{
   const page=await browser.newPage();
   await page.goto(url+'/creator/read-committed');
   const source=readFileSync('./isolated-browser-creator-http-adapter.mjs','utf8');
   const result=await page.evaluate(async({source,url,owner,canonical})=>{
    const moduleUrl='data:text/javascript;base64,'+btoa(source);
    const {createBrowserCreatorHttpAdapter}=await import(moduleUrl);
    const adapter=createBrowserCreatorHttpAdapter({baseUrl:url,getBearerToken:async()=>owner});
    const projectId='frontend-boundary-compatibility',operationId='admit1:browser',expectedRevision=6;
    const proposedState={...canonical.state,content:'physical-chromium-server-persisted-scene'};
    const receipt=await adapter.commit({projectId,operationId,expectedRevision,proposedState});
    const readback=await adapter.readCommitted({projectId,operationId});
    return {receipt,readback,proposedState};
   },{source,url,owner,canonical});
   assert.equal(result.receipt.committedRevision,7);
   assert.equal(result.readback.serverCommitId,result.receipt.serverCommitId);
   assert.deepEqual(result.readback.state,result.proposedState);
   await page.close();
   const fresh=await browser.newPage();
   await fresh.goto(url+'/creator/read-committed');
   const recovered=await fresh.evaluate(async({source,url,owner})=>{
    const {createBrowserCreatorHttpAdapter}=await import('data:text/javascript;base64,'+btoa(source));
    const adapter=createBrowserCreatorHttpAdapter({baseUrl:url,getBearerToken:async()=>owner});
    return adapter.readCommitted({projectId:'frontend-boundary-compatibility',operationId:'admit1:browser'});
   },{source,url,owner});
   assert.deepEqual(recovered.state,result.proposedState);
   assert.equal(recovered.serverCommitId,result.receipt.serverCommitId);
   assert.equal((await gate.states.findOne({projectId})).revision,7);
   assert.equal(await editor.edits.countDocuments({projectId}),5);
   console.log('GREEN PHYSICAL_CHROMIUM_AUTHENTICATED_HTTP_COMMIT_AND_READBACK');
   console.log('GREEN PHYSICAL_CHROMIUM_FRESH_PAGE_DURABLE_READBACK');
  }finally{await browser.close()}
 }else if(phase==='revoke'){
  assert.equal(canonical.revision,7);await gate.states.updateOne({_id:canonical._id,revoked:false},{$set:{revoked:true}});
  assert.notEqual((await read(owner,'admit1:edit1')).status,200);
  assert.notEqual((await read(owner,'admit1:edit2')).status,200);
  assert.notEqual((await commit(owner,'admit1:edit3',4,{...canonical.state,content:'forbidden'})).status,200);
  assert.equal((await gate.states.findOne({projectId})).revision,7);assert.equal(await editor.edits.countDocuments({projectId}),5);
  console.log('GREEN HTTP_REVOKED_OWNER_READ_AND_EDIT_DENIED');
  console.log('HELD ORIGINAL_FRONTEND_RED_AND_REAL_UI_INTEGRATION');
 }else throw Error('unknown phase');
}finally{await new Promise(resolve=>server.close(resolve));await client.close()}
