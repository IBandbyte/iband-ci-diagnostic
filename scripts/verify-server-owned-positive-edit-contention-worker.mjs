import assert from 'node:assert/strict';
import {MongoClient} from 'mongodb';
import {createPublicKey} from 'node:crypto';
import {createWritableAdmissionGate} from './isolated-writable-admission-gate.mjs';
import {createServerOwnedEditor} from './isolated-server-owned-positive-editor.mjs';
const client=new MongoClient(process.env.MONGO_URI,{serverSelectionTimeoutMS:12000});await client.connect();
try{
 const db=client.db('server_positive_edit_court'),key=createPublicKey(process.env.PUBLIC_KEY_PEM),gate=createWritableAdmissionGate({db,client,publicKey:key}),editor=createServerOwnedEditor({gate,db,client,publicKey:key});
 const projectId='film-positive-edit',token=process.env.OWNER_TOKEN,phase=process.argv[2],index=Number(process.argv[3]);
 if(phase==='contend'){
  const admission=await gate.admissions.findOne({projectId});assert.ok(admission);
  const result=await editor.edit({token,projectId,operationId:'admit1:contender-'+index,fence:admission.fence,expectedRevision:3,content:'director-'+index});
  console.log('CONTENDER_RESULT '+index+' '+(result.ok?'COMMITTED':'DENIED'));
 }else if(phase==='verify'){
  const state=await gate.states.findOne({projectId});assert.equal(state.revision,4);
  assert.match(state.state.content,/^director-[01]$/);
  const records=await editor.edits.find({projectId,expectedRevision:3}).toArray();
  assert.equal(records.length,1);
  assert.equal(records[0].revision,4);
  assert.equal(records[0].stateDigest.length,64);
  console.log('GREEN TWO_INDEPENDENT_EDIT_CONTENDERS_ONE_COMMITTED');
  console.log('HELD REAL_FACADE_WRITABLE_ADOPTION_AND_ORIGINAL_FRONTEND_RED');
 }else throw Error('unknown phase');
}finally{await client.close()}
