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
import {createIsolatedApplicationRecoveryAdoption} from './isolated-application-recovery-adoption-boundary.mjs';
import {createIsolatedApplicationEditableAdoption} from './isolated-application-editable-adoption-boundary.mjs';

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
 const projects=db.collection('projects');
 for(const collection of [provenance.states,provenance.ledger,provenance.grants,gate.admissions,authority.receipts])await collection.deleteMany({projectId:vault});
 for(const collection of [provenance.states,provenance.ledger,provenance.grants,gate.admissions])await collection.deleteMany({projectId:otherId});
 await projects.deleteMany({_id:otherId});
 await provenance.ledger.createIndex({projectId:1,operationId:1},{unique:true});
 await gate.admissions.createIndex({projectId:1,operationId:1},{unique:true});
 await authority.receipts.createIndex({projectId:1,operationId:1},{unique:true});
 await provenance.states.insertOne({projectId:vault,ownerId:'owner-1',revision:0,ownershipRevision:1,revoked:false,state:{content:{activeProjectId:project.id,projects:[{id:project.id,ownerId:'owner-1'},{id:otherId,ownerId:'owner-1'}]},durablePublicationOutbox:[]}});
 assert.equal((await provenance.append({token:owner,projectId:vault,operationId:'original-selection',expectedRevision:0,content:{activeProjectId:project.id,projects:[{id:project.id,ownerId:'owner-1'},{id:otherId,ownerId:'owner-1'}]}})).ok,true);
 const secondScenes=[{id:'scene-other-1',text:'Independent second film opening scene'}];
 await projects.insertOne({_id:otherId,ownerId:'owner-1',revision:1,state:{scenes:secondScenes}});
 await provenance.states.insertOne({projectId:otherId,ownerId:'owner-1',revision:0,ownershipRevision:1,revoked:false,state:{content:{scenes:[]},durablePublicationOutbox:[]}});
 assert.equal((await provenance.append({token:owner,projectId:otherId,operationId:'second-film-publication',expectedRevision:0,content:{scenes:secondScenes}})).ok,true);
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
 const readSelected=x=>authority.read(x);
 const readProject=async({token,projectId})=>{
   const sub=gate.authenticateOwner(token);
   if(!sub)return {ok:false};
   const found=await projects.findOne({_id:projectId,ownerId:sub});
   return found?{ok:true,projectId:found._id,revision:found.revision,state:found.state}:{ok:false};
 };
 const readOnlyViews=[],editableViews=[];
 const recovery=createIsolatedApplicationRecoveryAdoption({
   readSelected,readProject,onVerifiedReadOnly:x=>readOnlyViews.push(x)
 });
 const rejected=await recovery.inspect({token:intruder,selectionVaultId:vault,projectId:otherId});
 assert.equal(rejected.ok,false);assert.equal(readOnlyViews.length,0);
 const wrong=await recovery.inspect({token:owner,selectionVaultId:vault,projectId:project.id});
 assert.equal(wrong.ok,false);assert.equal(readOnlyViews.length,0);
 const recovered=await recovery.inspect({token:owner,selectionVaultId:vault,projectId:otherId});
 assert.equal(recovered.ok,true);assert.equal(recovered.mode,'read-only');
 assert.equal(recovered.snapshot.selectionRevision,2);
 assert.equal(recovered.snapshot.projectRevision,1);
 assert.deepEqual(recovered.snapshot.scenes,secondScenes);
 assert.equal(recovered.snapshot.writable,false);
 assert.equal(await gate.admissions.countDocuments({projectId:otherId}),0);
 assert.equal(storage.getItem('iband.creator-memory'),bytes);
 console.log('GREEN ORIGINAL_CONTINUITY_SECOND_FILM_AUTHENTICATED_READ_ONLY_RECOVERY_NO_LOCAL_REBASE');
 const createEditor=onVerifiedEditable=>createIsolatedApplicationEditableAdoption({
   readSelected,readProject,
   issueGrant:async({token,projectId,revision})=>{
     const g=await provenance.issue({token,projectId,revision});
     return g?{grantId:g.grantId,projectId,revision}:null;
   },
   admit:x=>gate.admit(x),readAdmission:x=>gate.readAdmission(x),onVerifiedEditable
 });
 const editor=createEditor(x=>editableViews.push(x));
 const noReadonly=await editor.activate({token:owner,selectionVaultId:vault,readOnlySnapshot:null,operationId:'continuity-adopt-other'});
 assert.equal(noReadonly.ok,false);
 assert.equal(await gate.admissions.countDocuments({projectId:otherId}),0);
 const forged=await editor.activate({token:intruder,selectionVaultId:vault,readOnlySnapshot:recovered.snapshot,operationId:'continuity-intruder'});
 assert.equal(forged.ok,false);
 assert.equal(await gate.admissions.countDocuments({projectId:otherId}),0);
 const admitted=await editor.activate({token:owner,selectionVaultId:vault,readOnlySnapshot:recovered.snapshot,operationId:'continuity-adopt-other'});
 assert.equal(admitted.ok,true,JSON.stringify(admitted));
 assert.equal(admitted.adoption.projectId,otherId);
 assert.equal(admitted.adoption.serverOwned,true);
 assert.equal(admitted.adoption.writable,true);
 assert.ok(admitted.adoption.fence);
 assert.equal(await gate.admissions.countDocuments({projectId:otherId}),1);
 assert.equal(await provenance.grants.countDocuments({projectId:otherId,status:'consumed'}),1);
 assert.equal(editableViews.length,1);
 assert.equal(storage.getItem('iband.creator-memory'),bytes);
 assert.equal(runtimeB.getResumeSnapshot().projectId,project.id);
 console.log('GREEN ORIGINAL_CONTINUITY_SECOND_FILM_PROVENANCE_FENCED_EDITABLE_ADMISSION_NO_LOCAL_REBASE');
 // A fresh app instance must start in read-only mode, even when an earlier
 // process obtained a consumed admission. It must never inherit a local fence.
 const memoryC=createCreatorMemory({storageAdapter:storage,projectIdentityCrypto:cryptoImpl,requireSharedWriteAuthority:true});
 const runtimeC=createMovieMentorStudioIdentityRuntime({memory:memoryC,cryptoImpl,settlementLockManager:locks});
 assert.equal(runtimeC.getResumeSnapshot().projectId,project.id);
 const freshRecovery=createIsolatedApplicationRecoveryAdoption({readSelected,readProject,onVerifiedReadOnly:()=>{}});
 const freshRead=await freshRecovery.inspect({token:owner,selectionVaultId:vault,projectId:otherId});
 assert.equal(freshRead.ok,true);assert.equal(freshRead.snapshot.writable,false);
 const freshEditor=createEditor(()=>{throw Error('fresh editor unexpectedly acquired')});
 assert.equal(freshEditor.getSnapshot(),null);
 const noDuplicate=await freshEditor.activate({token:owner,selectionVaultId:vault,readOnlySnapshot:freshRead.snapshot,operationId:'continuity-adopt-other-again'});
 assert.equal(noDuplicate.ok,false);
 assert.equal(await gate.admissions.countDocuments({projectId:otherId}),1);
 assert.equal(storage.getItem('iband.creator-memory'),bytes);
 const stillDenied=await memoryC.replaceStateWithSharedAuthority({locks,transform:state=>({...state,journey:{...(state.journey||{}),activeProjectId:null}})});
 assert.equal(stillDenied.acquired,false);
 assert.equal(stillDenied.reason,'publication-outbox-provenance-unverified');
 assert.equal(storage.getItem('iband.creator-memory'),bytes);
 console.log('GREEN ORIGINAL_CONTINUITY_FRESH_APP_READ_ONLY_AND_REISSUE_DENIED_LOCAL_WRITER_STILL_LOCKED');
 console.log('HELD ORIGINAL_FRONTEND_CONTINUITY_RED_AND_APPLICATION_AUTHORITATIVE_ADOPTION');
}finally{await client.close()}
