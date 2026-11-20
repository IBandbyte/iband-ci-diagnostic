import assert from 'node:assert/strict';
import {MongoClient} from 'mongodb';
import {createPublicKey} from 'node:crypto';
import {createProvenanceAuthority} from './isolated-server-publication-provenance.mjs';
import {createWritableAdmissionGate} from './isolated-writable-admission-gate.mjs';
const client=new MongoClient(process.env.MONGO_URI);await client.connect();
try{
 const db=client.db('writable_admission_physical'),key=createPublicKey(process.env.PUBLIC_KEY_PEM),a=createProvenanceAuthority({db,client,publicKey:key}),gate=createWritableAdmissionGate({db,client,publicKey:key}),projectId='film-writable-admission',token=process.env.OWNER_TOKEN,phase=process.argv[2];
 if(phase==='seed'){
  await a.states.deleteMany({projectId});await a.ledger.deleteMany({projectId});await a.grants.deleteMany({projectId});await gate.admissions.deleteMany({projectId});
  await a.states.insertOne({projectId,ownerId:'owner-1',ownershipRevision:1,revoked:false,revision:1,state:{content:'scene-one',durablePublicationOutbox:[]}});
  assert.equal((await a.append({token,projectId,operationId:'publish-1',expectedRevision:1,content:'scene-two'})).ok,true);
  const g1=await a.issue({token,projectId,revision:2}),g2=await a.issue({token,projectId,revision:2});
  assert.ok(g1&&g2);console.log('GREEN WRITABLE_ADMISSION_SERVER_ORIGIN_NONEMPTY_LEDGER');
 }else if(phase==='contend'){
  const grants=await a.grants.find({projectId}).sort({grantId:1}).toArray(),index=Number(process.argv[3]);
  const result=await gate.admit({token,projectId,grantId:grants[index].grantId,operationId:'writer-'+index,revision:2});
  console.log('WRITER_RESULT '+index+' '+(result.acquired?'ACQUIRED':'DENIED'));
 }else if(phase==='restart'){
  const [a1]=await gate.admissions.find({projectId}).toArray();assert.ok(a1);
  const read=await gate.readAdmission({token,projectId,operationId:a1.operationId,fence:a1.fence});
  assert.equal(read?.state?.durablePublicationOutbox?.length,1);
  assert.equal(await gate.readAdmission({token:process.env.INTRUDER_TOKEN,projectId,operationId:a1.operationId,fence:a1.fence}),null);
  assert.equal(await gate.readAdmission({token,projectId,operationId:a1.operationId,fence:'forged'}),null);
  assert.equal(await gate.admissions.countDocuments({projectId}),1);
  console.log('GREEN FRESH_PROCESS_FENCED_WRITABLE_READBACK_AND_INTRUDER_DENIAL');
  await gate.ledger.updateOne({projectId},{$set:{'entry.snapshotDigest':'tampered'}});
  assert.equal(await gate.readAdmission({token,projectId,operationId:a1.operationId,fence:a1.fence}),null);
  console.log('GREEN LEDGER_TAMPER_AFTER_ADMISSION_DENIED');
  console.log('HELD REAL_FACADE_WRITABLE_LOCAL_ADOPTION_AND_ORIGINAL_FRONTEND_RED');
 }else throw Error('unknown phase');
}finally{await client.close()}
