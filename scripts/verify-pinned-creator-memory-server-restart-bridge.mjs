// Physical integration of exact pinned CreatorMemory continuation facade to a trusted
// server-owned Mongo adoption/continuation adapter. Diagnostic only, read-only local.
import assert from 'node:assert/strict';
import {MongoClient} from 'mongodb';
import {createPublicKey} from 'node:crypto';
import createCreatorMemory,{createMemoryStorageAdapter} from '../frontend/src/components/studio/mentor/CreatorMemory.js';
import {createProvenanceAuthority} from './isolated-server-publication-provenance.mjs';
import {createRestartContinuationAuthority} from './isolated-server-restart-continuation-authority.mjs';

const client=new MongoClient(process.env.MONGO_URI,{serverSelectionTimeoutMS:12000});
await client.connect();
const db=client.db('isolated_pinned_creator_memory_server_restart_bridge');
const provenance=createProvenanceAuthority({db,client,publicKey:createPublicKey(process.env.PUBLIC_KEY_PEM)});
const authority=createRestartContinuationAuthority({db,client,publicKey:createPublicKey(process.env.PUBLIC_KEY_PEM)});
const projectId='real-facade-bridge-film',operationId='real-facade-next-scene';
const scene={id:'scene-two',text:'Continue after secure restart'};
const local=createMemoryStorageAdapter();
const memory=createCreatorMemory({storageAdapter:local,requireSharedWriteAuthority:true});
const localBefore=structuredClone(memory.readPersistedState());
const storageBefore=local.getItem('iband.creator-memory');
try{
 await Promise.all([
  provenance.states.deleteMany({}),provenance.ledger.deleteMany({}),
  provenance.grants.deleteMany({}),authority.effects.deleteMany({})
 ]);
 await provenance.ledger.createIndex({projectId:1,operationId:1},{unique:true});
 await authority.effects.createIndex({projectId:1,operationId:1},{unique:true});
 await provenance.states.insertOne({projectId,ownerId:'owner-1',revision:0,ownershipRevision:1,revoked:false,state:{content:{scenes:[]},durablePublicationOutbox:[]}});
 assert.equal((await provenance.append({token:process.env.OWNER_TOKEN,projectId,operationId:'scene-one',expectedRevision:0,content:{scenes:[{id:'scene-one',text:'Opening scene'}]}})).ok,true);
 const issued=await provenance.issue({token:process.env.OWNER_TOKEN,projectId,revision:1});
 assert.ok(issued?.grantId);
 assert.equal(await provenance.consume({token:process.env.OWNER_TOKEN,projectId,grantId:issued.grantId}),true);
 const snapshot=await authority.read({token:process.env.OWNER_TOKEN,projectId});
 assert.equal(snapshot.status,'ok');assert.equal(snapshot.revision,1);
 const proposedState={...snapshot.state,content:{...snapshot.state.content,scenes:[...snapshot.state.content.scenes,scene]}};
 // Trusted diagnostic server adapter holds its own authenticated principal.
 // The boundary cannot mint a token, consume grants, or modify local outbox.
 const serverAdapter={
  async commit({projectId:pid,operationId:oid,expectedRevision,proposedState:proposal}){
   if(pid!==projectId||oid!==operationId||expectedRevision!==1||
      JSON.stringify(proposal)!==JSON.stringify(proposedState))return null;
   const result=await authority.continueNextScene({token:process.env.OWNER_TOKEN,projectId:pid,grantId:issued.grantId,operationId:oid,expectedRevision,nextScene:scene});
   if(result.status!=='committed')return null;
   return {status:'committed',...result.receipt};
  },
  async readCommitted({projectId:pid,operationId:oid}){
   if(pid!==projectId||oid!==operationId)return null;
   const result=await authority.read({token:process.env.OWNER_TOKEN,projectId:pid});
   if(result.status!=='ok')return null;
   const record=await authority.effects.findOne({projectId:pid,operationId:oid});
   if(!record)return null;
   return {projectId:pid,operationId:oid,committedRevision:record.receipt.committedRevision,serverCommitId:record.receipt.serverCommitId,state:result.state};
  }
 };
 const result=await memory.continueWithDurableServerAuthority({
  projectId,operationId,expectedRevision:1,authenticatedSession:{diagnostic:true},
  proposedState,authorityAdapter:serverAdapter
 });
 assert.equal(result.acquired,true);
 assert.equal(result.committedRevision,2);
 assert.equal(result.restorationMode,'server-read-only');
 assert.equal(result.localStateAdopted,false);
 assert.deepEqual(result.state,proposedState);
 assert.deepEqual(memory.readPersistedState(),localBefore);
 assert.equal(local.getItem('iband.creator-memory'),storageBefore);
 console.log('GREEN PINNED_CREATOR_MEMORY_REAL_SERVER_AUTHORITY_POSITIVE_READ_ONLY_CONTINUATION');
 console.log('GREEN PINNED_CREATOR_MEMORY_NO_LOCAL_OUTBOX_REBASE_OR_PERSISTENCE_WRITE');

 const unknown=await memory.continueWithDurableServerAuthority({
  projectId,operationId:'unknown-operation',expectedRevision:2,authenticatedSession:{diagnostic:true},
  proposedState:{...proposedState,content:{scenes:[...proposedState.content.scenes,{id:'scene-three',text:'unverified'}]}},
  authorityAdapter:serverAdapter
 });
 assert.equal(unknown.acquired,false);
 assert.equal(unknown.reason,'durable-commit-unverified');
 assert.deepEqual(memory.readPersistedState(),localBefore);
 const deniedRead=await authority.read({token:process.env.INTRUDER_TOKEN,projectId});
 assert.equal(deniedRead.status,'denied');
 assert.equal(await authority.effects.countDocuments({projectId}),1);
 console.log('GREEN PINNED_CREATOR_MEMORY_UNVERIFIED_NEXT_WRITE_DENIED_WITHOUT_LOCAL_MUTATION');
 console.log('GREEN PINNED_CREATOR_MEMORY_SERVER_INTRUDER_DENIED');
 console.log('HELD ORIGINAL_FRONTEND_RED_AND_PRODUCTION_RESTART_PUBLICATION_ADOPTION');
}finally{await client.close();}
