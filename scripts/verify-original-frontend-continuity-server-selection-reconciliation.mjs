// Original frontend continuity reconciliation: preserve the genuine strict RED,
// prove server-authorised cross-film selection without any local outbox mutation.
// This is an isolated physical Mongo court, NOT an original-regression fix.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateKeyPairSync,sign} from 'node:crypto';
import {MongoClient} from 'mongodb';
import createCreatorMemory,{createMemoryStorageAdapter} from '../frontend/src/components/studio/mentor/CreatorMemory.js';
import createMovieMentorStudioIdentityRuntime from '../frontend/src/components/studio/mentor/MovieMentorStudioIdentityRuntime.js';
import {createProvenanceAuthority} from './isolated-server-publication-provenance.mjs';
import {createWritableAdmissionGate} from './isolated-writable-admission-gate.mjs';
import {createServerProjectSelectionAuthority} from './isolated-server-original-red-project-selection.mjs';
import {createIsolatedStudioServerSelectionAdoption} from './isolated-studio-server-selection-adoption.mjs';

const original=readFileSync('../frontend/scripts/verify-movie-mentor-conversation-continuity.mjs','utf8');
assert.match(original,/assert\.equal\(cleared\.acquired, true\)/);
assert.match(original,/memoryB\.replaceStateWithSharedAuthority\(/);
const storage=createMemoryStorageAdapter(),ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'];
let nextId=0;
const cryptoImpl={randomUUID:()=>ids[nextId++]};
const locks={request:async(_name,optionsOrCallback,maybeCallback)=>{
 const callback=typeof optionsOrCallback==='function'?optionsOrCallback:maybeCallback;
 return callback({name:'exclusive',mode:'exclusive'});
}};
const memoryA=createCreatorMemory({storageAdapter:storage,projectIdentityCrypto:cryptoImpl,requireSharedWriteAuthority:true});
const runtimeA=createMovieMentorStudioIdentityRuntime({memory:memoryA,cryptoImpl,settlementLockManager:locks});
const created=await runtimeA.ensureProjectWithSharedAuthority({title:'Midnight Door',projectJourney:{currentStageId:'story'}});
assert.equal(created.acquired,true);
const project=runtimeA.getActiveProject();assert.ok(project?.id);
runtimeA.recordConversationMessage(project.id,{role:'creator',text:'The red door should appear at midnight.'},{projectJourney:{currentStageId:'story'}});
const settled=await runtimeA.settleConversationMessage(project.id,{role:'mentor',text:'Good. We will make midnight the repeating trigger.',metadata:{backendMetadata:{creatorTurnId:'midnight-door-turn-1'}}},{projectJourney:{currentStageId:'story'}});
assert.equal(settled.status,'conversation-persisted');
const memoryB=createCreatorMemory({storageAdapter:storage,projectIdentityCrypto:cryptoImpl,requireSharedWriteAuthority:true});
const runtimeB=createMovieMentorStudioIdentityRuntime({memory:memoryB,cryptoImpl,settlementLockManager:locks});
assert.equal(runtimeB.getResumeSnapshot().projectId,project.id);
const persisted=memoryB.readPersistedState();
assert.ok(persisted.durablePublicationOutbox?.length>0);
const bytes=storage.getItem('iband.creator-memory');
const denied=await memoryB.replaceStateWithSharedAuthority({locks,transform:state=>({...state,journey:{...(state.journey||{}),activeProjectId:null}})});
assert.equal(denied.acquired,false);
assert.equal(denied.reason,'publication-outbox-provenance-unverified');
assert.equal(storage.getItem('iband.creator-memory'),bytes);
console.log('GREEN ORIGINAL_CONTINUITY_RESTART_UNWITNESSED_LOCAL_SWITCH_DENIED_WITHOUT_MUTATION');

const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const now=Math.floor(Date.now()/1000),b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const jwt=sub=>{const raw=b64({alg:'RS256',typ:'JWT'})+'.'+b64({iss:'https://isolated-auth.test',aud:'movie-mentor-creator-write',sub,iat:now,nbf:now-1,exp:now+600});return raw+'.'+sign('RSA-SHA256',Buffer.from(raw),privateKey).toString('base64url')};
const owner=jwt('owner-1'),intruder=jwt('intruder');
const client=new MongoClient(process.env.MONGO_URI,{serverSelectionTimeoutMS:12000});
await client.connect();
try{
 const db=client.db('isolated_original_continuity_reconciliation');
 const provenance=createProvenanceAuthority({db,client,publicKey});
 const gate=createWritableAdmissionGate({db,client,publicKey});
 const authority=createServerProjectSelectionAuthority({gate,db,client});
 const vault='original-continuity-selection-vault',otherId='independent-server-film';
 for(const collection of [provenance.states,provenance.ledger,provenance.grants,gate.admissions,authority.receipts])await collection.deleteMany({projectId:vault});
 await provenance.ledger.createIndex({projectId:1,operationId:1},{unique:true});
 await authority.receipts.createIndex({projectId:1,operationId:1},{unique:true});
 await provenance.states.insertOne({projectId:vault,ownerId:'owner-1',revision:0,ownershipRevision:1,revoked:false,state:{content:{activeProjectId:project.id,projects:[{id:project.id,ownerId:'owner-1'},{id:otherId,ownerId:'owner-1'}]},durablePublicationOutbox:[]}});
 assert.equal((await provenance.append({token:owner,projectId:vault,operationId:'original-selection',expectedRevision:0,content:{activeProjectId:project.id,projects:[{id:project.id,ownerId:'owner-1'},{id:otherId,ownerId:'owner-1'}]}})).ok,true);
 const projected=[];
 const selection=createIsolatedStudioServerSelectionAdoption({
  authority:{read:x=>authority.read(x),select:x=>authority.select(x)},
  onCommitted:x=>projected.push(x)
 });
 assert.equal((await selection.load({token:owner,projectId:vault})).ok,true);
 assert.equal(selection.getSnapshot().activeProjectId,project.id);
 const unowned=await selection.change({token:owner,projectId:vault,operationId:'unowned',nextActiveProjectId:'not-owned'});
 assert.equal(unowned.ok,false);
 assert.equal(selection.getSnapshot().activeProjectId,project.id);
 const switched=await selection.change({token:owner,projectId:vault,operationId:'server-selected-other',nextActiveProjectId:otherId});
 assert.equal(switched.ok,true);
 assert.equal(switched.selection.activeProjectId,otherId);
 assert.equal((await authority.read({token:owner,projectId:vault})).activeProjectId,otherId);
 assert.equal((await authority.read({token:intruder,projectId:vault})).ok,false);
 assert.equal(await authority.receipts.countDocuments({projectId:vault,operationId:'server-selected-other'}),1);
 assert.equal(storage.getItem('iband.creator-memory'),bytes);
 assert.equal(runtimeB.getResumeSnapshot().projectId,project.id);
 console.log('GREEN ORIGINAL_CONTINUITY_SERVER_OWNED_SECOND_FILM_SELECTION_RECEIPT_WITHOUT_LOCAL_REBASE');
 const restart=createIsolatedStudioServerSelectionAdoption({authority:{read:x=>authority.read(x),select:x=>authority.select(x)},onCommitted:()=>{}});
 assert.equal((await restart.load({token:owner,projectId:vault})).ok,true);
 assert.equal(restart.getSnapshot().activeProjectId,otherId);
 const replay=await authority.select({token:owner,projectId:vault,operationId:'server-selected-other',nextActiveProjectId:otherId,expectedRevision:1});
 assert.equal(replay.ok,true);
 assert.equal(await authority.receipts.countDocuments({projectId:vault,operationId:'server-selected-other'}),1);
 const secondDenial=await memoryB.replaceStateWithSharedAuthority({locks,transform:state=>({...state,journey:{...(state.journey||{}),activeProjectId:null}})});
 assert.equal(secondDenial.acquired,false);
 assert.equal(storage.getItem('iband.creator-memory'),bytes);
 console.log('GREEN ORIGINAL_CONTINUITY_FRESH_SELECTOR_READBACK_REPLAY_AND_LOCAL_WRITER_STILL_DENIED');
 console.log('HELD ORIGINAL_FRONTEND_CONTINUITY_RED_AND_APPLICATION_AUTHORITATIVE_ADOPTION');
}finally{await client.close()}
