import assert from 'node:assert/strict';
import {MongoClient} from 'mongodb';
import {createPublicKey} from 'node:crypto';
import {createProvenanceAuthority} from './isolated-server-publication-provenance.mjs';
import {createWritableAdmissionGate} from './isolated-writable-admission-gate.mjs';
import {createServerOwnedEditor} from './isolated-server-owned-positive-editor.mjs';
const client=new MongoClient(process.env.MONGO_URI,{serverSelectionTimeoutMS:12000});await client.connect();
try{
 const db=client.db('server_positive_edit_court'),key=createPublicKey(process.env.PUBLIC_KEY_PEM),authority=createProvenanceAuthority({db,client,publicKey:key}),gate=createWritableAdmissionGate({db,client,publicKey:key}),editor=createServerOwnedEditor({gate,db,client,publicKey:key});
 const projectId='film-positive-edit',token=process.env.OWNER_TOKEN,phase=process.argv[2];
 if(phase==='seed'){
  for(const coll of [authority.states,authority.ledger,authority.grants,gate.admissions,editor.edits])await coll.deleteMany({projectId});
  await authority.states.insertOne({projectId,ownerId:'owner-1',ownershipRevision:1,revoked:false,revision:1,state:{content:'scene-one',durablePublicationOutbox:[]}});
  assert.equal((await authority.append({token,projectId,operationId:'publish-1',expectedRevision:1,content:'scene-two'})).ok,true);
  const g=await authority.issue({token,projectId,revision:2});assert.ok(g);
  const a=await gate.admit({token,projectId,grantId:g.grantId,operationId:'admit1',revision:2});assert.equal(a.acquired,true);
  console.log('GREEN POSITIVE_EDIT_SERVER_ADMISSION');
 }else if(phase==='edit'){
  const a=await gate.admissions.findOne({projectId});assert.ok(a);
  const result=await editor.edit({token,projectId,operationId:'admit1:edit1',fence:a.fence,expectedRevision:2,content:'creator-approved-scene-three'});
  assert.equal(result.ok,true,JSON.stringify(result));
  const s=await authority.states.findOne({projectId});assert.equal(s.revision,3);assert.equal(s.state.content,'creator-approved-scene-three');assert.equal(s.state.durablePublicationOutbox.length,1);
  console.log('GREEN POSITIVE_SERVER_OWNED_EDIT_COMMITTED');
 }else if(phase==='restart'){
  const a=await gate.admissions.findOne({projectId});assert.ok(a);
  const s=await authority.states.findOne({projectId});assert.equal(s.state.content,'creator-approved-scene-three');
  const replay=await editor.edit({token,projectId,operationId:'admit1:edit1',fence:a.fence,expectedRevision:2,content:'creator-approved-scene-three'});
  assert.equal(replay.ok,true,JSON.stringify(replay));assert.equal(replay.replay,true);
  assert.equal(await editor.edits.countDocuments({projectId}),1);
  assert.equal((await authority.states.findOne({projectId})).revision,3);
  console.log('GREEN FRESH_PROCESS_POSITIVE_EDIT_REPLAY_EXACTLY_ONCE');
  const intruder=await editor.edit({token:process.env.INTRUDER_TOKEN,projectId,operationId:'admit1:edit2',fence:a.fence,expectedRevision:3,content:'intruder'});
  assert.equal(intruder.ok,false);
  const stale=await editor.edit({token,projectId,operationId:'admit1:edit2',fence:a.fence,expectedRevision:2,content:'stale'});
  assert.equal(stale.ok,false);
  console.log('GREEN INTRUDER_AND_STALE_REVISION_DENIED');
  console.log('HELD REAL_FACADE_WRITABLE_ADOPTION_AND_ORIGINAL_FRONTEND_RED');
 }else throw Error('unknown phase');
}finally{await client.close()}
