// Independent-process physical Mongo owner/grant/revision continuation court.
import assert from 'node:assert/strict';
import {MongoClient} from 'mongodb';
import {createPublicKey} from 'node:crypto';
import {createProvenanceAuthority} from './isolated-server-publication-provenance.mjs';
import {createRestartContinuationAuthority} from './isolated-server-restart-continuation-authority.mjs';
const phase=process.argv[2],projectId='restart-authorised-film',operationId='restart-next-scene';
const client=new MongoClient(process.env.MONGO_URI,{serverSelectionTimeoutMS:12000});await client.connect();
const db=client.db('isolated_server_restart_positive_publication');
const provenance=createProvenanceAuthority({db,client,publicKey:createPublicKey(process.env.PUBLIC_KEY_PEM)});
const authority=createRestartContinuationAuthority({db,client,publicKey:createPublicKey(process.env.PUBLIC_KEY_PEM)});
const checkpoints=db.collection('court_checkpoints'),scene={id:'scene-two',text:'A second scene after verified restart'};
try{
 if(phase==='seed'){
  await Promise.all([provenance.states.deleteMany({}),provenance.ledger.deleteMany({}),provenance.grants.deleteMany({}),authority.effects.deleteMany({}),checkpoints.deleteMany({})]);
  await provenance.ledger.createIndex({projectId:1,operationId:1},{unique:true});
  await authority.effects.createIndex({projectId:1,operationId:1},{unique:true});
  await provenance.states.insertOne({projectId,ownerId:'owner-1',revision:0,ownershipRevision:1,revoked:false,state:{content:{scenes:[]},durablePublicationOutbox:[]}});
  const first=await provenance.append({token:process.env.OWNER_TOKEN,projectId,operationId:'scene-one',expectedRevision:0,content:{scenes:[{id:'scene-one',text:'Original confirmed film scene'}]}});
  assert.equal(first.ok,true);
  const issued=await provenance.issue({token:process.env.OWNER_TOKEN,projectId,revision:1});
  assert.ok(issued?.grantId);
  const consumed=await provenance.consume({token:process.env.OWNER_TOKEN,projectId,grantId:issued.grantId});
  assert.equal(consumed,true);
  await checkpoints.insertOne({_id:'grant',grantId:issued.grantId});
  console.log('GREEN SERVER_RESTART_DURABLE_ADOPTION_GRANT_CONSUMED');
 }else if(phase==='restart'){
  const {grantId}=await checkpoints.findOne({_id:'grant'});
  const bad=await authority.continueNextScene({token:process.env.INTRUDER_TOKEN,projectId,grantId,operationId,expectedRevision:1,nextScene:scene});
  assert.equal(bad.status,'denied');
  const stale=await authority.continueNextScene({token:process.env.OWNER_TOKEN,projectId,grantId,operationId,expectedRevision:0,nextScene:scene});
  assert.equal(stale.status,'denied');
  const forged=await authority.continueNextScene({token:process.env.OWNER_TOKEN,projectId,grantId:'forged',operationId,expectedRevision:1,nextScene:scene});
  assert.equal(forged.status,'denied');
  const authorized=await authority.continueNextScene({token:process.env.OWNER_TOKEN,projectId,grantId,operationId,expectedRevision:1,nextScene:scene});
  assert.equal(authorized.status,'committed');
  assert.equal(authorized.receipt.committedRevision,2);
  console.log('GREEN SERVER_RESTART_FRESH_PROCESS_OWNER_GRANT_REVISION_NEXT_SCENE_COMMIT');
  console.log('GREEN SERVER_RESTART_INTRUDER_STALE_AND_FORGED_GRANTS_DENIED');
 }else if(phase==='verify'){
  const {grantId}=await checkpoints.findOne({_id:'grant'});
  const ownerRead=await authority.read({token:process.env.OWNER_TOKEN,projectId});
  assert.equal(ownerRead.status,'ok');
  assert.equal(ownerRead.revision,2);
  assert.deepEqual(ownerRead.state.content.scenes.map(x=>x.id),['scene-one','scene-two']);
  assert.equal((await authority.read({token:process.env.INTRUDER_TOKEN,projectId})).status,'denied');
  const replay=await authority.continueNextScene({token:process.env.OWNER_TOKEN,projectId,grantId,operationId,expectedRevision:1,nextScene:scene});
  assert.equal(replay.status,'replayed');
  const tampered=await authority.continueNextScene({token:process.env.OWNER_TOKEN,projectId,grantId,operationId,expectedRevision:1,nextScene:{...scene,text:'tampered'}});
  assert.equal(tampered.status,'denied');
  assert.equal(await authority.effects.countDocuments({projectId}),1);
  const snap=await authority.states.findOne({projectId});assert.equal(snap.revision,2);
  assert.equal(snap.activeAdoptionGrant,undefined);
  console.log('GREEN SERVER_RESTART_FRESH_PROCESS_DURABLE_READBACK_AND_EXACTLY_ONCE_REPLAY');
  console.log('GREEN SERVER_RESTART_REPLAY_TAMPERING_AND_UNAUTHORISED_READ_DENIED');
  console.log('HELD ORIGINAL_FRONTEND_RED_AND_REAL_CREATOR_MEMORY_PUBLICATION_INTEGRATION');
 }else throw Error('unknown phase');
}finally{await client.close();}
