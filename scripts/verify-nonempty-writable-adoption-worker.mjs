import assert from 'node:assert/strict';
import {MongoClient} from 'mongodb';
import {createPublicKey} from 'node:crypto';
import {createProvenanceAuthority} from './isolated-server-publication-provenance.mjs';
const client=new MongoClient(process.env.MONGO_URI,{serverSelectionTimeoutMS:12000});await client.connect();
try{
 const db=client.db('nonempty_writable_adoption_contention');
 const a=createProvenanceAuthority({db,client,publicKey:createPublicKey(process.env.PUBLIC_KEY_PEM)});
 const projectId='nonempty-adoption-contention-film',token=process.env.OWNER_TOKEN,phase=process.argv[2];
 if(phase==='seed'){
  await a.states.deleteMany({projectId});await a.ledger.deleteMany({projectId});await a.grants.deleteMany({projectId});
  await a.states.insertOne({projectId,ownerId:'owner-1',ownershipRevision:1,revoked:false,revision:1,state:{content:'scene-one',durablePublicationOutbox:[]}});
  assert.equal((await a.append({token,projectId,operationId:'server-origin-publication-1',expectedRevision:1,content:'scene-two'})).ok,true);
  const g1=await a.issue({token,projectId,revision:2}),g2=await a.issue({token,projectId,revision:2});
  assert.ok(g1&&g2);
  console.log('GREEN NONEMPTY_SERVER_ORIGIN_LEDGER_TWO_GRANTS_ISSUED');
 }else if(phase==='compete'){
  const grants=await a.grants.find({projectId}).sort({grantId:1}).toArray();
  assert.equal(grants.length,2);
  const index=Number(process.argv[3]);assert.ok(index===0||index===1);
  const ok=await a.consume({token,projectId,grantId:grants[index].grantId});
  console.log('CONTENDER_RESULT '+index+' '+(ok?'ACQUIRED':'DENIED'));
 }else if(phase==='verify'){
  const s=await a.states.findOne({projectId}),grants=await a.grants.find({projectId}).toArray();
  assert.equal(grants.filter(g=>g.status==='consumed').length,1);
  assert.equal(grants.filter(g=>g.grantId===s.activeAdoptionGrant&&g.status==='consumed').length,1);
  assert.equal(await a.ledger.countDocuments({projectId}),1);
  assert.equal(await a.consume({token,projectId,grantId:s.activeAdoptionGrant}),false);
  assert.equal(await a.consume({token:process.env.INTRUDER_TOKEN,projectId,grantId:s.activeAdoptionGrant}),false);
  console.log('GREEN FRESH_PROCESS_ONE_WRITER_NONEMPTY_LEDGER_REPLAY_INTRUDER_DENIED');
  console.log('HELD REAL_FACADE_WRITABLE_ADOPTION_AND_ORIGINAL_CONTINUITY_RED');
 }else throw Error('unknown phase');
}finally{await client.close()}
