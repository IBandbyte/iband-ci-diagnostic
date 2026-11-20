import assert from 'node:assert/strict';
import {MongoClient} from 'mongodb';
import {createPublicKey} from 'node:crypto';
import {createWritableAdmissionGate} from './isolated-writable-admission-gate.mjs';
import {createServerOwnedEditor} from './isolated-server-owned-positive-editor.mjs';
const client=new MongoClient(process.env.MONGO_URI,{serverSelectionTimeoutMS:12000});await client.connect();
try {
 const db=client.db('server_positive_edit_court'),key=createPublicKey(process.env.PUBLIC_KEY_PEM),gate=createWritableAdmissionGate({db,client,publicKey:key}),editor=createServerOwnedEditor({gate,db,client,publicKey:key});
 const projectId='film-positive-edit',token=process.env.OWNER_TOKEN,phase=process.argv[2];
 const admission=await gate.admissions.findOne({projectId});assert.ok(admission);
 const input={token,projectId,fence:admission.fence};
 if(phase==='second'){
  const r=await editor.edit({...input,operationId:'admit1:edit2',expectedRevision:3,content:'creator-approved-scene-four'});
  assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.replay,false);
  const s=await gate.states.findOne({projectId});assert.equal(s.revision,4);assert.equal(s.state.content,'creator-approved-scene-four');
  assert.equal(await editor.edits.countDocuments({projectId}),2);
  console.log('GREEN SECOND_AUTHORIZED_EDIT_AFTER_FRESH_PROCESS');
 }else if(phase==='verify'){
  const second=await editor.edit({...input,operationId:'admit1:edit2',expectedRevision:3,content:'creator-approved-scene-four'});
  assert.equal(second.ok,true,JSON.stringify(second));assert.equal(second.replay,true);
  const first=await editor.edit({...input,operationId:'admit1:edit1',expectedRevision:2,content:'creator-approved-scene-three'});
  assert.equal(first.ok,true,'historical operation replay must return durable receipt without mutating newer canonical state: '+JSON.stringify(first));
  assert.equal(first.replay,true);
  const s=await gate.states.findOne({projectId});assert.equal(s.revision,4);assert.equal(s.state.content,'creator-approved-scene-four');
  assert.equal(await editor.edits.countDocuments({projectId}),2);
  const intruder=await editor.edit({...input,token:process.env.INTRUDER_TOKEN,operationId:'admit1:edit3',expectedRevision:4,content:'intruder'});
  assert.equal(intruder.ok,false);
  const stale=await editor.edit({...input,operationId:'admit1:edit3',expectedRevision:3,content:'stale'});
  assert.equal(stale.ok,false);
  console.log('GREEN HISTORICAL_AND_CURRENT_RECEIPT_REPLAY_NO_DUPLICATE');
  console.log('GREEN MULTI_EDIT_INTRUDER_AND_STALE_DENIAL');
  console.log('HELD REAL_FRONTEND_LOCAL_WRITABLE_RESTORATION_AND_ORIGINAL_RED');
 }else throw Error('unknown phase');
}finally{await client.close()}
