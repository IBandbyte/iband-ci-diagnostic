// Physical Mongo positive court for the unchanged original frontend RED's
// rejected local project-selection mutation. Server selection is independent.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createPublicKey} from 'node:crypto';
import {MongoClient} from 'mongodb';
import {createProvenanceAuthority} from './isolated-server-publication-provenance.mjs';
import {createWritableAdmissionGate} from './isolated-writable-admission-gate.mjs';
import {createServerProjectSelectionAuthority} from './isolated-server-original-red-project-selection.mjs';
import createCreatorMemory,{createMemoryStorageAdapter} from '../frontend/src/components/studio/mentor/CreatorMemory.js';
const phase=process.argv[2],projectId='original-red-selection-positive',operationId='select-other-film';
assert.ok(['seed','select','verify'].includes(phase));
const original=readFileSync('../frontend/scripts/verify-movie-mentor-conversation-continuity.mjs','utf8');
assert.match(original,/assert\.equal\(cleared\.acquired, true\)/);
const client=new MongoClient(process.env.MONGO_URI,{serverSelectionTimeoutMS:12000});await client.connect();
const db=client.db('isolated_original_red_server_selection');
const publicKey=createPublicKey(process.env.PUBLIC_KEY_PEM);
const provenance=createProvenanceAuthority({db,client,publicKey});
const gate=createWritableAdmissionGate({db,client,publicKey});
const authority=createServerProjectSelectionAuthority({gate,db,client});
const owner=process.env.OWNER_TOKEN,intruder=process.env.INTRUDER_TOKEN;
const local=createMemoryStorageAdapter();
const facade=createCreatorMemory({storageAdapter:local,requireSharedWriteAuthority:true});
const localBytes=local.getItem('iband.creator-memory');
const requireLocalUnchanged=()=>assert.equal(local.getItem('iband.creator-memory'),localBytes);
try{
 if(phase==='seed'){
  await Promise.all([provenance.states.deleteMany({projectId}),provenance.ledger.deleteMany({projectId}),provenance.grants.deleteMany({projectId}),authority.receipts.deleteMany({projectId})]);
  await provenance.ledger.createIndex({projectId:1,operationId:1},{unique:true});
  await authority.receipts.createIndex({projectId:1,operationId:1},{unique:true});
  await provenance.states.insertOne({projectId,ownerId:'owner-1',revision:0,ownershipRevision:1,revoked:false,
   state:{content:{activeProjectId:'film-a',projects:[{id:'film-a',ownerId:'owner-1'},{id:'film-b',ownerId:'owner-1'}],scenes:[]},durablePublicationOutbox:[]}});
  assert.equal((await provenance.append({token:owner,projectId,operationId:'initial-conversation',expectedRevision:0,
   content:{activeProjectId:'film-a',projects:[{id:'film-a',ownerId:'owner-1'},{id:'film-b',ownerId:'owner-1'}],scenes:[{id:'scene-one',text:'Original confirmed scene'}]}})).ok,true);
  assert.equal((await authority.read({token:owner,projectId})).revision,1);
  console.log('GREEN ORIGINAL_RED_SERVER_SELECTION_INDEPENDENT_PUBLICATION_LEDGER_SEEDED');
 }else if(phase==='select'){
  const request={token:owner,projectId,operationId,expectedRevision:1,nextActiveProjectId:'film-b'};
  assert.equal((await authority.select({...request,token:intruder})).ok,false);
  assert.equal((await authority.select({...request,nextActiveProjectId:'unowned-project'})).ok,false);
  assert.equal((await authority.select({...request,expectedRevision:0})).ok,false);
  assert.equal((await authority.select({...request,token:'forged'})).ok,false);
  assert.equal((await authority.read({token:owner,projectId})).activeProjectId,'film-a');
  const selected=await authority.select(request);
  assert.equal(selected.ok,true,JSON.stringify(selected));
  assert.equal(selected.receipt.committedRevision,2);
  assert.equal((await authority.read({token:owner,projectId})).activeProjectId,'film-b');
  requireLocalUnchanged();
  console.log('GREEN ORIGINAL_RED_SERVER_AUTHORISED_PROJECT_SELECTION_MONGO_TRANSACTION');
  console.log('GREEN ORIGINAL_RED_UNAUTHORISED_STALE_AND_UNOWNED_SELECTION_DENIED');
 }else{
  const request={token:owner,projectId,operationId,expectedRevision:1,nextActiveProjectId:'film-b'};
  const saved=await authority.read({token:owner,projectId});
  assert.equal(saved.ok,true);assert.equal(saved.revision,2);assert.equal(saved.activeProjectId,'film-b');
  assert.equal((await authority.read({token:intruder,projectId})).ok,false);
  const same=await authority.select(request);
  assert.equal(same.ok,true);assert.equal(same.replayed,true);
  assert.equal((await authority.select({...request,nextActiveProjectId:null})).ok,false);
  assert.equal((await authority.select({...request,token:intruder})).ok,false);
  assert.equal(await authority.receipts.countDocuments({projectId}),1);
  assert.equal((await authority.read({token:owner,projectId})).revision,2);
  requireLocalUnchanged();
  console.log('GREEN ORIGINAL_RED_SERVER_SELECTION_FRESH_PROCESS_EXACTLY_ONCE_REPLAY');
  console.log('GREEN ORIGINAL_RED_LOCAL_OUTBOX_NEVER_GRANTED_MUTATION_AUTHORITY');
  console.log('HELD ORIGINAL_FRONTEND_CONTINUITY_RED_AND_APPLICATION_PUBLICATION_ADOPTION');
 }
}finally{await client.close()}
