import assert from 'node:assert/strict';
import {MongoClient} from 'mongodb';
import {createPublicKey} from 'node:crypto';
import {createProvenanceAuthority} from './isolated-server-publication-provenance.mjs';
const client=new MongoClient(process.env.MONGO_URI,{serverSelectionTimeoutMS:12000});await client.connect();
try{
 const a=createProvenanceAuthority({db:client.db('server_provenance_positive_court'),client,publicKey:createPublicKey(process.env.PUBLIC_KEY_PEM)});
 const projectId='positive-provenance-film',token=process.env.OWNER_TOKEN,phase=process.argv[2];
 if(phase==='seed'){
  await a.states.deleteMany({projectId});await a.ledger.deleteMany({projectId});await a.grants.deleteMany({projectId});
  await a.states.insertOne({projectId,ownerId:'owner-1',ownershipRevision:1,revoked:false,revision:1,state:{content:'first',durablePublicationOutbox:[]}});
  const r=await a.append({token,projectId,operationId:'op-1',expectedRevision:1,content:'scene-two'});
  assert.equal(r.ok,true);assert.equal(await a.ledger.countDocuments({projectId}),1);
  console.log('GREEN SERVER_ATOMIC_NONEMPTY_OUTBOX_AND_LEDGER');
 }else if(phase==='restart'){
  const grant=await a.issue({token,projectId,revision:2});assert.ok(grant);
  assert.equal(await a.consume({token,projectId,grantId:grant.grantId}),true);
  assert.equal(await a.consume({token,projectId,grantId:grant.grantId}),false);
  assert.equal(await a.ledger.countDocuments({projectId}),1);
  console.log('GREEN FRESH_PROCESS_SERVER_PROVENANCE_GRANT_AND_REPLAY_DENIAL');
 }else if(phase==='deny'){
  assert.equal(await a.issue({token:process.env.INTRUDER_TOKEN,projectId,revision:2}),null);
  const s=await a.states.findOne({projectId});assert.equal(s.state.durablePublicationOutbox.length,1);
  await a.states.updateOne({projectId},{$set:{'state.durablePublicationOutbox.0.snapshotDigest':'f'.repeat(64)}});
  assert.equal(await a.issue({token,projectId,revision:2}),null);
  console.log('GREEN INTRUDER_AND_TAMPERED_LEDGER_DENIAL');
  console.log('HELD REAL_CREATOR_MEMORY_EDITABLE_INTEGRATION_AND_ORIGINAL_FRONTEND_RED');
 }else throw Error('unknown phase');
}finally{await client.close()}
