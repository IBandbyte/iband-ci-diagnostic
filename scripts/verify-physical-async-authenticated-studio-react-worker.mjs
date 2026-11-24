// Physically mount exact pinned CreatorWorkspace with an isolated Studio lifecycle
// controller, HTTP owner authentication and real Mongo readback. Disposable only.
import assert from 'node:assert/strict';
import {MongoClient} from 'mongodb';
import {createServer} from 'node:http';
import express from 'express';
import {createStudioVaultExpressRouter} from './isolated-studio-vault-express-router.mjs';
import {createPublicKey,verify} from 'node:crypto';
import {readFileSync,writeFileSync,rmSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {transformPinnedFencedConversationHandler} from './isolated-pinned-fenced-conversation-handler-candidate.mjs';
import {transformPinnedApplicationOwnedSecondFilmRecovery} from './isolated-pinned-application-owned-second-film-react-bridge.mjs';
import {transformPinnedApplicationOwnedConversationHandler} from './isolated-pinned-application-owned-conversation-bridge.mjs';
import {transformPinnedApplicationOwnedRecoveryServices} from './isolated-pinned-application-recovery-service-injection.mjs';
import {createProvenanceAuthority} from './isolated-server-publication-provenance.mjs';
import {createWritableAdmissionGate} from './isolated-writable-admission-gate.mjs';
import {createServerProjectSelectionAuthority} from './isolated-server-original-red-project-selection.mjs';
import {createStudioOwnerVaultAuthority} from './isolated-studio-owner-vault-authority.mjs';
import {createPhysicalProvenanceFencedSceneSettlement} from './isolated-physical-provenance-fenced-scene-settlement.mjs';
import createCreatorMemory,{createMemoryStorageAdapter} from '../frontend/src/components/studio/mentor/CreatorMemory.js';
import createMovieMentorStudioIdentityRuntime from '../frontend/src/components/studio/mentor/MovieMentorStudioIdentityRuntime.js';
const client=new MongoClient(process.env.MONGO_URI,{serverSelectionTimeoutMS:12000});await client.connect();
const db=client.db('isolated_async_authenticated_studio_react');
const projects=db.collection('projects'),receipts=db.collection('receipts'),grants=db.collection('writer_grants');
const key=createPublicKey(process.env.PUBLIC_KEY_PEM);
const base='__async_authenticated_studio_react';
const files=['../frontend/'+base+'.html','../frontend/'+base+'_entry.jsx','../frontend/'+base+'_vite.config.mjs','../frontend/src/components/studio/'+base+'.jsx','../frontend/'+base+'_runtime.mjs'];
const phase=process.argv[2];assert.ok(['seed','save','recover','revoked-restart','genesis-kill','genesis-retry','genesis-ack-kill','genesis-ack-retry','http-genesis-pre','http-genesis-post','http-genesis-retry'].includes(phase));
const selectionProjectId='physical-studio-selection-vault';
const vaultBindings=db.collection('studio_owner_vault_bindings');
const routeMode=process.env.PHYSICAL_STUDIO_ROUTE==='1';
// Reproduce the exact original restart/local-writer failure before any React
// projection. The server is NEVER permitted to mutate these persisted bytes.
const localStorage=createMemoryStorageAdapter();let uuidIndex=0;
const uuids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'];
const localCrypto={randomUUID:()=>uuids[uuidIndex++]};
const lockManager={request:async(_n,optionsOrCallback,maybeCallback)=>(typeof optionsOrCallback==='function'?optionsOrCallback:maybeCallback)({name:'exclusive',mode:'exclusive'})};
const originalMemory=createCreatorMemory({storageAdapter:localStorage,projectIdentityCrypto:localCrypto,requireSharedWriteAuthority:true});
const originalRuntime=createMovieMentorStudioIdentityRuntime({memory:originalMemory,cryptoImpl:localCrypto,settlementLockManager:lockManager});
const originalCreated=await originalRuntime.ensureProjectWithSharedAuthority({title:'Original Film A',projectJourney:{currentStageId:'story'}});
assert.equal(originalCreated.acquired,true);
const originalId=originalRuntime.getActiveProject().id;
originalRuntime.recordConversationMessage(originalId,{role:'creator',text:'Original film opening'},{projectJourney:{currentStageId:'story'}});
const originalSettled=await originalRuntime.settleConversationMessage(originalId,{role:'mentor',text:'Original film scene',metadata:{backendMetadata:{creatorTurnId:'original-turn'}}},{projectJourney:{currentStageId:'story'}});
assert.equal(originalSettled.status,'conversation-persisted');
const restartedMemory=createCreatorMemory({storageAdapter:localStorage,projectIdentityCrypto:localCrypto,requireSharedWriteAuthority:true});
const originalBytes=localStorage.getItem('iband.creator-memory');
const deniedLocal=await restartedMemory.replaceStateWithSharedAuthority({locks:lockManager,transform:state=>({...state,journey:{...(state.journey||{}),activeProjectId:null}})});
assert.equal(deniedLocal.acquired,false);assert.equal(deniedLocal.reason,'publication-outbox-provenance-unverified');
assert.equal(localStorage.getItem('iband.creator-memory'),originalBytes);
if(phase!=='seed')console.log('GREEN PHYSICAL_ORIGINAL_CONTINUITY_RESTART_LOCAL_WRITER_DENIED_UNCHANGED');
const provenance=createProvenanceAuthority({db,client,publicKey:key});
const selectionGate=createWritableAdmissionGate({db,client,publicKey:key});
const selectionAuthority=createServerProjectSelectionAuthority({gate:selectionGate,db,client});
const sceneAuthority=createPhysicalProvenanceFencedSceneSettlement({client,gate:selectionGate,projects,receipts});
let server,vite,browser;
const authenticate=header=>{
 try{const parts=header?.slice(7).split('.');if(!header.startsWith('Bearer ')||parts.length!==3)return null;const h=JSON.parse(Buffer.from(parts[0],'base64url'));const p=JSON.parse(Buffer.from(parts[1],'base64url'));const now=Math.floor(Date.now()/1000);if(h.alg!=='RS256'||p.iss!=='https://isolated-auth.test'||p.aud!=='movie-mentor-creator-write'||p.exp<=now||p.nbf>now)return null;return verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),key,Buffer.from(parts[2],'base64url'))?p.sub:null}catch{return null}
};
const vaultAuthority=createStudioOwnerVaultAuthority({bindings:vaultBindings,states:provenance.states,ledger:provenance.ledger,client,authenticateOwner:token=>authenticate('Bearer '+token),readSelection:selectionAuthority.read});
const readJson=async req=>{let s='';for await(const c of req){s+=c;if(s.length>32768)throw Error('too-large')}return JSON.parse(s)};
try{
 if(phase.startsWith('http-genesis-')){
  const pre=phase==='http-genesis-pre',post=phase==='http-genesis-post',retry=phase==='http-genesis-retry';
  const ownerId=process.env.HTTP_VAULT_OWNER;
  const lost=process.env.INTERRUPTED_VAULT_ID;
  const expectedExisting=retry&&process.env.HTTP_VAULT_COMMITTED==='1';
  for(const collection of [vaultBindings,provenance.states,provenance.ledger])assert.equal(await collection.countDocuments({ownerId}),expectedExisting?1:0);
  const candidate=createStudioOwnerVaultAuthority({bindings:vaultBindings,states:provenance.states,ledger:provenance.ledger,client,authenticateOwner:t=>authenticate('Bearer '+t),readSelection:selectionAuthority.read,beforeGenesisCommit:async proof=>{
   if(pre){assert.equal(proof.ownerId,ownerId);process.send({seam:'before-commit',vaultId:proof.vaultId});await new Promise(()=>{});}
  }});
  const app=express();app.use(express.json({limit:'16kb'}));
  app.use('/studio',createStudioVaultExpressRouter({authority:candidate,authenticateOwner:t=>authenticate('Bearer '+t),beforeReply:async({method,owner,result})=>{
   assert.equal(owner,ownerId);
   if(method==='create'&&post){assert.equal(result.replayed,false);process.send({seam:'after-commit',vaultId:result.vaultId});await new Promise(()=>{});}
   if(method==='create'&&retry){
    assert.equal(result.replayed,expectedExisting);
    if(expectedExisting)assert.equal(result.vaultId,lost);else assert.notEqual(result.vaultId,lost);
    for(const collection of [vaultBindings,provenance.states,provenance.ledger])assert.equal(await collection.countDocuments({ownerId}),1);
    if(!expectedExisting){
     assert.equal(await provenance.states.countDocuments({projectId:lost}),0);
     assert.equal(await provenance.ledger.countDocuments({projectId:lost}),0);
     assert.equal(await vaultBindings.countDocuments({vaultId:lost}),0);
    }
   }
  }}));
  server=app.listen(0,'127.0.0.1');
  await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject)});
  process.send({port:server.address().port});
  await new Promise(resolve=>process.once('message',m=>{assert.equal(m,'stop');resolve()}));
 }else if(phase==='genesis-kill'||phase==='genesis-ack-kill'){
  const token=phase==='genesis-kill'?process.env.KILL_OWNER_TOKEN:process.env.ACK_KILL_OWNER_TOKEN;
  const ownerId=phase==='genesis-kill'?'kill-owner':'ack-kill-owner';
  assert.equal(await vaultBindings.countDocuments({ownerId}),0);
  const candidate=createStudioOwnerVaultAuthority({bindings:vaultBindings,states:provenance.states,ledger:provenance.ledger,client,authenticateOwner:t=>authenticate('Bearer '+t),readSelection:selectionAuthority.read,beforeGenesisCommit:async proof=>{
   assert.equal(proof.ownerId,ownerId);
   if(phase==='genesis-kill'){
    process.send({seam:'before-commit',vaultId:proof.vaultId});
    await new Promise(()=>{});
   }
  }});
  const result=await candidate.create({token});
  assert.equal(phase,'genesis-ack-kill');
  assert.equal(result.ok,true);assert.equal(result.replayed,false);
  process.send({seam:'after-commit',vaultId:result.vaultId});
  await new Promise(()=>{});
 }else if(phase==='genesis-retry'||phase==='genesis-ack-retry'){
  const pre=phase==='genesis-retry',ownerId=pre?'kill-owner':'ack-kill-owner';
  const token=pre?process.env.KILL_OWNER_TOKEN:process.env.ACK_KILL_OWNER_TOKEN;
  const lostVault=process.env.INTERRUPTED_VAULT_ID;
  assert.ok(lostVault);
  for(const collection of [vaultBindings,provenance.states,provenance.ledger])assert.equal(await collection.countDocuments({ownerId}),pre?0:1);
  const result=await vaultAuthority.create({token});
  assert.equal(result.ok,true);assert.equal(result.replayed,!pre);
  if(pre)assert.notEqual(result.vaultId,lostVault);else assert.equal(result.vaultId,lostVault);
  assert.deepEqual(await vaultAuthority.resolve({token}),{ok:true,vaultId:result.vaultId});
  assert.deepEqual(await selectionAuthority.read({token,projectId:result.vaultId}),{ok:true,projectId:result.vaultId,revision:1,activeProjectId:null});
  for(const collection of [vaultBindings,provenance.states,provenance.ledger])assert.equal(await collection.countDocuments({ownerId}),1);
  if(pre){
   assert.equal(await provenance.states.countDocuments({projectId:lostVault}),0);
   assert.equal(await provenance.ledger.countDocuments({projectId:lostVault}),0);
   assert.equal(await vaultBindings.countDocuments({vaultId:lostVault}),0);
  }
  console.log(pre?'GREEN PHYSICAL_VAULT_GENESIS_SIGKILL_BEFORE_COMMIT_RETRY':'GREEN PHYSICAL_VAULT_GENESIS_SIGKILL_AFTER_COMMIT_EXACT_REPLAY');
 }else if(phase==='revoked-restart'){
  assert.equal((await vaultAuthority.resolve({token:process.env.OWNER_TOKEN})).ok,false);
  assert.equal((await vaultAuthority.provision({token:process.env.RENEWED_OWNER_TOKEN,vaultId:selectionProjectId})).ok,false);
  assert.equal((await selectionAuthority.read({token:process.env.RENEWED_OWNER_TOKEN,projectId:selectionProjectId})).ok,false);
  const row=await selectionAuthority.receipts.findOne({projectId:selectionProjectId});
  assert.ok(row);
  assert.equal((await selectionAuthority.select({token:process.env.OWNER_TOKEN,projectId:selectionProjectId,operationId:row.operationId,expectedRevision:row.expectedRevision,nextActiveProjectId:row.nextActiveProjectId})).ok,false);
  assert.equal(await vaultBindings.countDocuments({ownerId:'owner-1',revoked:true}),1);
  assert.equal(await provenance.states.countDocuments({projectId:selectionProjectId,ownerId:'owner-1',revoked:true,ownershipRevision:2}),1);
  assert.equal((await selectionAuthority.select({token:process.env.INTRUDER_TOKEN,projectId:'isolated-new-write-race-vault',operationId:'race-new-write',expectedRevision:1,nextActiveProjectId:null})).ok,false);
  assert.equal(await selectionAuthority.receipts.countDocuments({projectId:'isolated-new-write-race-vault'}),0);
  assert.equal(await provenance.states.countDocuments({projectId:'isolated-new-write-race-vault',revoked:true,revision:1,ownershipRevision:2}),1);
  assert.equal((await vaultAuthority.create({token:process.env.CANONICAL_OWNER_TOKEN})).ok,false);
  assert.equal(await vaultBindings.countDocuments({ownerId:'canonical-owner',revoked:true}),1);
  const canonical=await provenance.states.findOne({ownerId:'canonical-owner'});
  assert.equal(canonical.revoked,true);
  assert.equal(canonical.revision,1);
  assert.equal(await provenance.ledger.countDocuments({projectId:canonical.projectId}),1);
  const recoveredBinding=await vaultBindings.findOne({ownerId:'rollback-owner',revoked:false});
  assert.ok(recoveredBinding);
  assert.deepEqual(await vaultAuthority.resolve({token:process.env.ROLLBACK_OWNER_TOKEN}),{ok:true,vaultId:recoveredBinding.vaultId});
  assert.equal(await provenance.states.countDocuments({ownerId:'rollback-owner'}),1);
  assert.equal(await provenance.ledger.countDocuments({ownerId:'rollback-owner'}),1);
  console.log('GREEN PHYSICAL_VAULT_GENESIS_ROLLBACK_RETRY_FRESH_PROCESS_READBACK');
  console.log('GREEN PHYSICAL_CANONICAL_VAULT_GENESIS_FRESH_PROCESS_NON_RESURRECTION');
  console.log('GREEN PHYSICAL_NEW_SELECTION_WRITE_REVOCATION_FRESH_PROCESS_DENIAL');
  console.log('GREEN PHYSICAL_ATOMIC_VAULT_REVOCATION_FRESH_PROCESS_DENIAL');
 }else if(phase==='seed'){
  await Promise.all([projects.deleteMany({}),receipts.deleteMany({}),grants.deleteMany({}),provenance.states.deleteMany({}),provenance.ledger.deleteMany({}),provenance.grants.deleteMany({}),selectionGate.admissions.deleteMany({}),selectionAuthority.receipts.deleteMany({projectId:selectionProjectId})]);
  await vaultBindings.deleteMany({});
  await vaultAuthority.initialize();
  await receipts.createIndex({projectId:1,operationId:1},{unique:true});
  await grants.createIndex({projectId:1,operationId:1},{unique:true});
  await projects.insertMany([{_id:'film-a',ownerId:'owner-1',revision:1,state:{scenes:[{id:'scene-one',text:'Opening scene'}]}},{_id:'film-b',ownerId:'owner-1',revision:4,state:{scenes:[{id:'scene-b-next',text:'Film B next confirmed scene'}]}}]);
  await provenance.ledger.createIndex({projectId:1,operationId:1},{unique:true});
  await selectionGate.admissions.createIndex({projectId:1,operationId:1},{unique:true});
  await selectionAuthority.receipts.createIndex({projectId:1,operationId:1},{unique:true});
  await provenance.states.insertOne({projectId:selectionProjectId,ownerId:'owner-1',revision:0,ownershipRevision:1,revoked:false,state:{content:{activeProjectId:'film-a',projects:[{id:'film-a',ownerId:'owner-1'},{id:'film-b',ownerId:'owner-1'}]},durablePublicationOutbox:[]}});
  await provenance.states.insertOne({projectId:'film-b',ownerId:'owner-1',revision:0,ownershipRevision:1,revoked:false,state:{content:{scenes:[]},durablePublicationOutbox:[]}});
  for(let i=0;i<4;i++){const a=await provenance.append({token:process.env.OWNER_TOKEN,projectId:'film-b',operationId:'publish-film-b-'+i,expectedRevision:i,content:{scenes:i===3?[{id:'scene-b-next',text:'Film B next confirmed scene'}]:[]}});assert.equal(a.ok,true);}
  const started=await provenance.append({token:process.env.OWNER_TOKEN,projectId:selectionProjectId,operationId:'prior-confirmed-film',expectedRevision:0,content:{activeProjectId:'film-a',projects:[{id:'film-a',ownerId:'owner-1'},{id:'film-b',ownerId:'owner-1'}]}});
  assert.equal(started.ok,true);
  const provision=()=>vaultAuthority.provision({token:process.env.OWNER_TOKEN,vaultId:selectionProjectId});
  const attempts=await Promise.all([provision(),provision(),provision()]);
  assert.ok(attempts.every(x=>x.ok===true&&x.vaultId===selectionProjectId));
  assert.equal(await vaultBindings.countDocuments({}),1);
  assert.equal((await vaultAuthority.provision({token:process.env.INTRUDER_TOKEN,vaultId:selectionProjectId})).ok,false);
  assert.equal((await vaultAuthority.provision({token:process.env.OWNER_TOKEN,vaultId:'film-b'})).ok,false);
  console.log('GREEN PHYSICAL_OWNER_VAULT_PROVISION_CONCURRENT_CREATE_ONCE');
  console.log('GREEN PHYSICAL_STUDIO_SELECTION_SIGNED_MONGO_PROVENANCE_SEEDED');
 }else{
  server=createServer(async(req,res)=>{
   const reply=(code,data)=>{if(res.writableEnded)return;res.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data))};
   if(req.method!=='POST'||!req.url.startsWith('/studio/'))return reply(404,{ok:false});
   const owner=authenticate(req.headers.authorization);if(!owner)return reply(401,{ok:false});
   try{
    const input=await readJson(req);
    // Isolated candidate endpoint: derive identity only from verified subject.
    if(req.url==='/studio/selection-vault'){
      if(!input||Object.keys(input).length!==0)return reply(400,{ok:false});
      const proof=await vaultAuthority.resolve({token:req.headers.authorization.slice(7)});
      return reply(proof.ok?200:403,proof);
    }
    // Isolated authenticated creation endpoint; identity and content are server-owned.
    if(req.url==='/studio/selection-vault-create'){
      if(!input||Array.isArray(input)||typeof input!=='object'||Object.keys(input).length!==0)return reply(400,{ok:false});
      const result=await vaultAuthority.create({token:req.headers.authorization.slice(7)});
      return reply(result.ok?(result.replayed?200:201):403,result);
    }
    if(!input?.projectId)return reply(400,{ok:false});
    if(req.url==='/studio/selection-read'){
      const result=await selectionAuthority.read({token:req.headers.authorization.slice(7),projectId:input.projectId});
      return reply(result.ok?200:403,result);
    }
    if(req.url==='/studio/selection-change'){
      const result=await selectionAuthority.select({token:req.headers.authorization.slice(7),...input});
      return reply(result.ok?200:403,result);
    }
    const project=await projects.findOne({_id:input.projectId,ownerId:owner});
    if(!project)return reply(403,{ok:false});
    if(req.url==='/studio/read')return reply(200,{ok:true,projectId:project._id,revision:project.revision,state:project.state});
    if(req.url==='/studio/publication-grant'||req.url==='/studio/admit-publication'){
      const state=await provenance.states.findOne({projectId:input.projectId,ownerId:owner,revoked:false,revision:input.revision});
      if(!state||state.revision!==project.revision||JSON.stringify(state.state?.content?.scenes)!==JSON.stringify(project.state.scenes))return reply(403,{ok:false});
      if(req.url==='/studio/publication-grant'){
       const g=await provenance.issue({token:req.headers.authorization.slice(7),projectId:input.projectId,revision:input.revision});
       return reply(g?200:403,g?{grantId:g.grantId,projectId:input.projectId,revision:input.revision}:{ok:false});
      }
      const a=await selectionGate.admit({token:req.headers.authorization.slice(7),...input});
      return reply(a.acquired?200:403,a);
    }
    if(req.url==='/studio/read-admission'){
      const a=await selectionGate.readAdmission({token:req.headers.authorization.slice(7),...input});
      return reply(a?200:403,a||{ok:false});
    }
    if(req.url==='/studio/fenced-read-committed'){
      const result=await sceneAuthority.readCommitted({token:req.headers.authorization.slice(7),...input});
      return reply(result?200:404,result||{ok:false});
    }
    if(req.url==='/studio/fenced-save'){
      const result=await sceneAuthority.save({token:req.headers.authorization.slice(7),...input});
      if(input.simulateSocketLoss&&result.ok&&!result.replay){req.socket.destroy();return;}
      return reply(result.ok?200:403,result);
    }
    if(req.url==='/studio/admit'){
     if(project.revision!==input.expectedRevision||!input.operationId)return reply(409,{ok:false});
     const prior=await grants.findOne({projectId:input.projectId,operationId:input.operationId,ownerId:owner});
     if(prior)return reply(200,{ok:true,projectId:input.projectId,revision:prior.revision,fence:prior.fence});
     const fence='server-fence-'+input.projectId+'-'+input.operationId;
     await grants.insertOne({projectId:input.projectId,operationId:input.operationId,ownerId:owner,revision:project.revision,fence});
     return reply(200,{ok:true,projectId:input.projectId,revision:project.revision,fence});
    }
    if(req.url==='/studio/read-committed'){
     const prior=await receipts.findOne({projectId:input.projectId,operationId:input.operationId,ownerId:owner});
     return prior?reply(200,{ok:true,projectId:input.projectId,operationId:input.operationId,revision:prior.revision,serverCommitId:prior.commitId,state:prior.state}):reply(404,{ok:false});
    }
    if(req.url!=='/studio/save')return reply(404,{ok:false});
    const session=client.startSession();
    try{
     const result=await session.withTransaction(async()=>{
      const grant=await grants.findOne({projectId:input.projectId,ownerId:owner,fence:input.fence},{session});
      if(!grant||!input.operationId?.startsWith(grant.operationId+':'))return {status:403};
      const prior=await receipts.findOne({projectId:input.projectId,operationId:input.operationId},{session});
      if(prior)return prior.ownerId===owner&&prior.fence===input.fence&&JSON.stringify(prior.scene)===JSON.stringify(input.scene)?{status:200,receipt:prior}:{status:409};
      const current=await projects.findOne({_id:input.projectId,ownerId:owner},{session});
      if(current?.revision!==input.expectedRevision||!input.scene?.id||typeof input.scene.text!=='string'||current.state.scenes.some(x=>x.id===input.scene.id))return {status:409};
      const state={scenes:[...current.state.scenes,input.scene]};
      const revised=await projects.updateOne({_id:input.projectId,ownerId:owner,revision:input.expectedRevision},{$set:{revision:input.expectedRevision+1,state}},{session});
      if(revised.modifiedCount!==1)throw Error('writer-race');
      const receipt={projectId:input.projectId,operationId:input.operationId,ownerId:owner,fence:input.fence,scene:input.scene,revision:input.expectedRevision+1,commitId:'server-'+input.operationId,state};
      await receipts.insertOne(receipt,{session});return {status:200,receipt};
     },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'}});
     if(result.status!==200)return reply(result.status,{ok:false});
     return reply(200,{ok:true,projectId:input.projectId,operationId:input.operationId,committedRevision:result.receipt.revision,serverCommitId:result.receipt.commitId});
    }finally{await session.endSession()}
   }catch(e){return reply(409,{ok:false,error:String(e.message||e)})}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const source=readFileSync('../frontend/src/components/studio/CreatorWorkspace.jsx','utf8');
  assert.ok(source.includes('<main style={styles.workspace}>'));
  assert.ok(source.includes('const [activeMovieProject, setActiveMovieProject] = useState(resumeSnapshot?.project || null);'));
  // Keep the entire genuine component source intact. Add a diagnostic-only
  // lifecycle panel, not a replacement for the application's existing handler.
  const panel='<section aria-label="Consolidated Studio continuity"><button onClick={()=>void globalThis.__continuity.open({token:globalThis.__diagnosticToken,selectionVaultId:"physical-studio-selection-vault"})}>Open server continuity</button><button onClick={()=>void globalThis.__continuity.switchFilm({token:globalThis.__diagnosticToken,selectionVaultId:"physical-studio-selection-vault",operationId:"select-film-b",nextProjectId:"film-b"})}>Choose Film B through continuity</button><button onClick={()=>void globalThis.__continuity.recover({token:globalThis.__diagnosticToken,selectionVaultId:"physical-studio-selection-vault"})}>Recover selected film read-only</button><button onClick={()=>void globalThis.__continuity.requestEditing({token:globalThis.__diagnosticToken,selectionVaultId:"physical-studio-selection-vault",operationId:"adopt-film-b"})}>Request authorised editing through continuity</button><output aria-label="Consolidated continuity mode">{__continuityView?.mode||"none"} | {__continuityView?.projectId||"none"} | {__continuityView?.writable?"writable":"blocked"} | {__continuityView?.scenes?.map(s=>s.text).join(" / ")||""}</output><output aria-label="Server selection">{__diagnosticSelectionView?.activeProjectId||"none"} | {__diagnosticSelectionView?.revision??"none"}</output><output aria-label="Recovered film">{__diagnosticApplicationView?.projectId||"none"} | {__diagnosticApplicationView?.projectRevision??"none"} | {__diagnosticApplicationView?.scenes?.map(s=>s.text).join(" / ")||""}</output><output aria-label="Server editable authority">{__diagnosticEditableView?.projectId||"none"} | {__diagnosticEditableView?.revision??"none"} | {__diagnosticEditableView?.writable?"writable":"blocked"}</output><button onClick={()=>handleMovieMessage({id:"creator-turn-new",role:"creator",text:"Continue Film B in real handler"})}>Creator handler turn</button><button onClick={()=>handleMovieMessage({id:"mentor-scene-new",role:"mentor",text:"Film B conversation scene",metadata:{backendMetadata:{creatorTurnId:"creator-turn-new"}}})}>Mentor handler scene</button><output aria-label="Creator message display">{movieMessages.map(m=>m.text).join(" / ")}</output><output aria-label="Local movie identity">{activeMovieProject?.id||"none"}</output></section>';
  // Use a normal React state subscription so the projection is observable.
  const stateAnchor='const [movieMessages, setMovieMessages] = useState(resumeSnapshot?.conversationMessages || []);';
  assert.ok(source.includes(stateAnchor));
  const insert='const [__diagnosticLifecycleView, __setDiagnosticLifecycleView] = useState(null);globalThis.__diagnosticStudioView=__setDiagnosticLifecycleView;const [__diagnosticSelectionView,__setDiagnosticSelectionView]=useState(null);globalThis.__diagnosticSelectionView=__setDiagnosticSelectionView;const [__diagnosticApplicationView,__setDiagnosticApplicationView]=useState(null);globalThis.__diagnosticApplicationView=__setDiagnosticApplicationView;const [__diagnosticEditableView,__setDiagnosticEditableView]=useState(null);globalThis.__diagnosticEditableView=__setDiagnosticEditableView;const [__continuityView,__setContinuityView]=useState(null);globalThis.__continuityView=(v)=>{__setContinuityView(v);if(v?.mode==="server-editable"&&v?.writable)setActiveMovieProject({id:v.projectId});else setActiveMovieProject({id:"film-a"});};';
  let candidate=transformPinnedApplicationOwnedRecoveryServices(transformPinnedApplicationOwnedConversationHandler(transformPinnedFencedConversationHandler(transformPinnedApplicationOwnedSecondFilmRecovery(source))));
  const projectAnchor='const [activeMovieProject, setActiveMovieProject] = useState(resumeSnapshot?.project || null);';
  assert.ok(candidate.includes(projectAnchor));
  candidate=candidate.replace(projectAnchor,'const [activeMovieProject, setActiveMovieProject] = useState({id:"film-a"});');
  candidate=candidate.replace(stateAnchor,stateAnchor+'\n  '+insert).replace('<main style={styles.workspace}>','<main style={styles.workspace}>'+panel.replaceAll('globalThis.__studioLifecycleResult?.','__diagnosticLifecycleView?.'));
  writeFileSync(files[3],candidate);
  writeFileSync(files[4],readFileSync('./isolated-real-studio-lifecycle-handoff.mjs','utf8'));
  const continuityModule='../frontend/'+base+'_continuity.mjs';files.push(continuityModule);writeFileSync(continuityModule,readFileSync('./isolated-studio-continuity-migration-candidate.mjs','utf8'));
  const migratedModule='../frontend/'+base+'_second_film.mjs';files.push(migratedModule);writeFileSync(migratedModule,readFileSync('./isolated-original-continuity-second-film-migration.mjs','utf8'));
  const selectionModule='../frontend/'+base+'_selection.mjs';files.push(selectionModule);
  writeFileSync(selectionModule,readFileSync('./isolated-studio-server-selection-adoption.mjs','utf8'));
  const editableModule='../frontend/'+base+'_editable.mjs';files.push(editableModule);writeFileSync(editableModule,readFileSync('./isolated-application-editable-adoption-boundary.mjs','utf8'));
  const applicationModule='../frontend/'+base+'_application.mjs';files.push(applicationModule);writeFileSync(applicationModule,readFileSync('./isolated-application-recovery-adoption-boundary.mjs','utf8'));
  const boundaryModule='../frontend/'+base+'_boundary.mjs';files.push(boundaryModule);writeFileSync(boundaryModule,readFileSync('./isolated-application-owned-second-film-boundary.mjs','utf8'));
  const composedModule='../frontend/'+base+'_composed.mjs';files.push(composedModule);let composedSource=readFileSync('./isolated-application-owned-studio-service-composition.mjs','utf8');
  const compositionImports=[
    ['isolated-studio-server-selection-adoption.mjs','_selection.mjs'],
    ['isolated-application-recovery-adoption-boundary.mjs','_application.mjs'],
    ['isolated-application-editable-adoption-boundary.mjs','_editable.mjs'],
    ['isolated-studio-continuity-migration-candidate.mjs','_continuity.mjs'],
    ['isolated-application-owned-second-film-boundary.mjs','_boundary.mjs'],
    ['isolated-original-continuity-second-film-migration.mjs','_second_film.mjs']
  ];
  for(const [from,to] of compositionImports){
    const expected='./'+from;
    assert.equal(composedSource.split(expected).length,2,'composition import source drift: '+from);
    composedSource=composedSource.replace(expected,'./'+base+to);
  }
  writeFileSync(composedModule,composedSource);
  const asyncModule='../frontend/'+base+'_async_session.mjs';files.push(asyncModule);
  let asyncSource=readFileSync('./isolated-application-studio-async-clerk-session-adapter.mjs','utf8');
  assert.equal(asyncSource.split('./isolated-application-owned-studio-service-composition.mjs').length,2,'async session composition import drift');
  asyncSource=asyncSource.replace('./isolated-application-owned-studio-service-composition.mjs','./'+base+'_composed.mjs');
  writeFileSync(asyncModule,asyncSource);
  if(routeMode){
   const factoryModule='../frontend/'+base+'_factory.mjs';files.push(factoryModule);
   let factorySource=readFileSync('./isolated-application-studio-session-factory.mjs','utf8');
   const factoryImport='./isolated-application-studio-async-clerk-session-adapter.mjs';
   assert.equal(factorySource.split(factoryImport).length,2);
   writeFileSync(factoryModule,factorySource.replace(factoryImport,'./'+base+'_async_session.mjs'));
   const {transformPinnedStudioRouteToAuthorityShell}=await import('../scripts/isolated-pinned-studio-route-authority-candidate.mjs');
   const appPath='../frontend/src/'+base+'_App.jsx';
   const shellPath='../frontend/src/components/studio/mentor/StudioRouteAuthorityShell.jsx';
   const lifecyclePath='../frontend/src/components/studio/mentor/MovieMentorStudioRouteLifecycle.mjs';
   for(const p of [appPath,shellPath,lifecyclePath])files.push(p);
   let app=transformPinnedStudioRouteToAuthorityShell(readFileSync('../frontend/src/App.jsx','utf8'));
   const anchor='import StudioRouteAuthorityShell from "./components/studio/mentor/StudioRouteAuthorityShell.jsx";';
   assert.equal(app.split(anchor).length,2);
   app=app.replace(anchor,anchor+'\nimport {createRouteSession,RouteWorkspace} from "../'+base+'_entry.jsx";');
   const route='element={<StudioRouteAuthorityShell onGenerate={generateMovieMentorLiveResponse} />}';
   assert.equal(app.split(route).length,2);
   app=app.replace(route,'element={<StudioRouteAuthorityShell onGenerate={generateMovieMentorLiveResponse} createSession={createRouteSession} WorkspaceComponent={RouteWorkspace} />}');
   writeFileSync(appPath,app);
   writeFileSync(shellPath,readFileSync('../scripts/isolated-studio-route-authority-react-shell.jsx','utf8'));
   writeFileSync(lifecyclePath,readFileSync('../scripts/isolated-studio-authority-route-lifecycle.mjs','utf8'));
  }
  writeFileSync(files[1],`import React from 'react';import {createRoot} from 'react-dom/client';import CreatorWorkspace from './src/components/studio/${base}.jsx';import {createIsolatedStudioLifecycleCoordinator} from './${base}_runtime.mjs';import {createIsolatedStudioServerSelectionAdoption} from './${base}_selection.mjs';import {createIsolatedApplicationRecoveryAdoption} from './${base}_application.mjs';import {createIsolatedApplicationEditableAdoption} from './${base}_editable.mjs';import {createIsolatedStudioContinuityMigration} from './${base}_continuity.mjs';import {selectSecondFilmWithServerAuthority} from './${base}_second_film.mjs';import {createApplicationSecondFilmBoundary} from './${base}_boundary.mjs';import {createApplicationOwnedStudioServices} from './${base}_composed.mjs';import {createAsyncAuthenticatedStudioSession} from './${base}_async_session.mjs';const request=async(path,data)=>{const r=await fetch(path,{method:'POST',headers:{authorization:'Bearer '+globalThis.__diagnosticToken,'content-type':'application/json'},body:JSON.stringify(data)});return r.json()};const authority={readProject:id=>request('/studio/read',{projectId:id}),admit:x=>request('/studio/admit',x),saveScene:x=>request('/studio/save',x),readCommitted:x=>request('/studio/read-committed',x)};globalThis.__studioLifecycle=createIsolatedStudioLifecycleCoordinator({authority,view:s=>globalThis.__diagnosticStudioView?.(s)});globalThis.__diagnosticStudioLifecycle=globalThis.__studioLifecycle;const transport=async({path,token,body})=>{const response=await fetch(path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});return response.json()};const makeSession=(getAuthToken,onAuthInvalidated)=>createAsyncAuthenticatedStudioSession({transport,getAuthToken,onAuthInvalidated,selectionVaultId:"physical-studio-selection-vault",readLocalBytes:()=>JSON.stringify(globalThis.localStorage.getItem('iband.creator-memory')),onSelection:x=>globalThis.__diagnosticSelectionView?.(x),onReadOnly:x=>globalThis.__diagnosticApplicationView?.(x),onEditable:x=>globalThis.__diagnosticEditableView?.(x),onView:v=>globalThis.__continuityView?.(v)});const asyncSession=makeSession(async()=>globalThis.__diagnosticToken);const openedSession=await asyncSession.open();if(!openedSession.ok)throw Error('physical-async-auth-open-denied');const app=openedSession.services;globalThis.__physicalAsyncSessionReady=true;globalThis.__serverSelection=app.studioServices.selection;globalThis.__applicationEditable=app.studioServices.editable;globalThis.__continuity=app.recoveryServices().continuity;const applicationSecondFilm=app.applicationSecondFilm,studioServices=app.studioServices,studioRecoveryServices=app.recoveryServices();Object.defineProperty(globalThis,'__diagnosticConversationPending',{get:()=>studioServices.pending});createRoot(document.getElementById('root')).render(<CreatorWorkspace applicationSecondFilm={applicationSecondFilm} studioServices={studioServices} studioRecoveryServices={studioRecoveryServices} creatorName="Diagnostic Creator" />);`);
  if(routeMode){
   let entry=readFileSync(files[1],'utf8');
   const marker='const asyncSession=makeSession(async()=>globalThis.__diagnosticToken);';
   assert.equal(entry.split(marker).length,2);
   entry=entry.split(marker)[0]+`import {BrowserRouter} from 'react-router-dom';import App from './src/${base}_App.jsx';import {setMovieMentorCreatorAuthState,clearMovieMentorCreatorAuthState} from './src/components/studio/mentor/MovieMentorCreatorAuthenticationTransport.js';
import {createApplicationStudioSessionFactory} from './${base}_factory.mjs';
const routeFactory=createApplicationStudioSessionFactory({transport,resolveSelectionVaultId:async({token})=>{const proof=await transport({path:'/studio/selection-vault',token,body:{}});return proof?.ok===true?proof.vaultId:null},readLocalBytes:()=>JSON.stringify(globalThis.localStorage.getItem('iband.creator-memory')),onSelection:x=>globalThis.__diagnosticSelectionView?.(x),onReadOnly:x=>globalThis.__diagnosticApplicationView?.(x),onEditable:x=>globalThis.__diagnosticEditableView?.(x),onView:v=>globalThis.__continuityView?.(v)});
export function createRouteSession(auth){const session=routeFactory(auth);globalThis.__routeSession=session;return session;}
export function RouteWorkspace(props){const {applicationSecondFilm,studioServices,studioRecoveryServices}=props;globalThis.__physicalAsyncSessionReady=true;globalThis.__serverSelection=studioServices.selection;globalThis.__applicationEditable=studioServices.editable;globalThis.__continuity=studioRecoveryServices.continuity;Object.defineProperty(globalThis,'__diagnosticConversationPending',{configurable:true,get:()=>studioServices.pending});globalThis.__routeRetainedServices=studioServices;return <CreatorWorkspace {...props} creatorName="Diagnostic Creator"/>;}
globalThis.__routeSignIn=()=>setMovieMentorCreatorAuthState({isLoaded:true,isSignedIn:true,getToken:async()=>globalThis.__diagnosticToken});
globalThis.__routeSignOut=()=>clearMovieMentorCreatorAuthState();
history.replaceState({},'', '/studio');createRoot(document.getElementById('root')).render(<BrowserRouter><App/></BrowserRouter>);`;
   writeFileSync(files[1],entry);
  }
  writeFileSync(files[0],`<html><body><div id="root"></div><script type="module" src="/${base}_entry.jsx"></script></body></html>`);
  writeFileSync(files[2],`import {defineConfig} from 'vite';import react from '@vitejs/plugin-react-swc';export default defineConfig({plugins:[react()],server:{proxy:{'/studio':{target:'http://127.0.0.1:${server.address().port}',changeOrigin:true}}}});`);
  vite=spawn('./node_modules/.bin/vite',['--host','127.0.0.1','--port','52767','--strictPort','--config',base+'_vite.config.mjs'],{cwd:'../frontend',stdio:['ignore','pipe','pipe']});
  let errors='';vite.stderr.on('data',c=>errors+=c);vite.stdout.on('data',c=>errors+=c);
  let ready=false;for(let i=0;i<100;i++){if(vite.exitCode!==null)throw Error('vite-failed '+errors.slice(-1200));try{if((await fetch('http://127.0.0.1:52767/'+base+'.html')).ok){ready=true;break}}catch{}await delay(150)}
  assert.ok(ready,'vite-not-ready '+errors.slice(-1200));
  const {chromium}=await import('playwright');browser=await chromium.launch({headless:true});
  const page=await browser.newPage(),pageErrors=[];page.on('pageerror',e=>pageErrors.push(String(e)));
  await page.addInitScript(token=>{globalThis.__diagnosticToken=token;globalThis.__originalBrowserMemoryBytes=globalThis.localStorage.getItem('iband.creator-memory');},process.env.OWNER_TOKEN);
  await page.goto('http://127.0.0.1:52767/'+base+'.html');
  if(routeMode){
   await page.getByRole('status',{name:'Studio authority locked'}).waitFor({timeout:15000});
   assert.equal(await page.getByRole('heading',{name:/Welcome back, Diagnostic Creator/}).count(),0);
   await page.evaluate(token=>{globalThis.__diagnosticToken=token;globalThis.__routeSignIn()},process.env.INTRUDER_TOKEN);
   await page.locator('[data-denial-reason="studio-auth-unverified"]').waitFor({state:'attached',timeout:15000});
   assert.equal(await page.getByRole('heading',{name:/Welcome back, Diagnostic Creator/}).count(),0);
   assert.equal(await page.evaluate(()=>globalThis.__routeSession.getServices()),null);
   console.log('GREEN PHYSICAL_APPLICATION_FACTORY_INTRUDER_VAULT_ADMISSION_DENIED');
   await page.evaluate(token=>{globalThis.__diagnosticToken=token;globalThis.__routeSignIn()},process.env.OWNER_TOKEN);
  }
  await page.getByRole('heading',{name:/Welcome back, Diagnostic Creator/}).waitFor({timeout:15000});
  if(routeMode){
   assert.equal(await page.evaluate(()=>globalThis.__routeSession.getServices().recoveryServices().selectionVaultId),selectionProjectId);
   console.log('GREEN PHYSICAL_APPLICATION_FACTORY_SIGNED_VAULT_ADMISSION_BEFORE_WORKSPACE');
  }
  const selected=page.getByLabel('Server selection'),recovered=page.getByLabel('Recovered film'),editable=page.getByLabel('Server editable authority'),local=page.getByLabel('Local movie identity'),continuity=page.getByLabel('Consolidated continuity mode');
  async function poll(loc,word){for(let i=0;i<120;i++){if((await loc.textContent()||'').includes(word))return;await delay(40)}throw Error('expected '+word+' got '+await loc.textContent())}
  await page.getByRole('button',{name:'Open server continuity'}).click();
  // The existing original local writer has no post-restart authority, even
  // when the independent server displays/edits a different film.
  assert.equal(localStorage.getItem('iband.creator-memory'),originalBytes);
  if(phase==='save'){
   await poll(selected,'film-a | 1');
   await page.getByRole('button',{name:'Creator handler turn'}).click();
   assert.equal(await receipts.countDocuments({projectId:'film-b'}),0);
   assert.match(await local.textContent(),/film-a/);
   await page.getByLabel('Existing movie project ID').fill('film-b');
   await page.getByRole('button',{name:'Recover server-authorised film'}).click();
   await poll(selected,'film-b | 2');
   await poll(recovered,'Film B next confirmed scene');
   await poll(page.getByRole('status').filter({hasText:'Server-verified film-b'}),'Film B next confirmed scene');
   await poll(continuity,'read-only | film-b | blocked');
   assert.equal(await page.evaluate(()=>globalThis.__applicationSecondFilmPhysicalCalls),1,'real migrated second-film caller must execute in mounted React');
   assert.match(await local.textContent(),/film-a/);
   assert.equal(await receipts.countDocuments({projectId:'film-b'}),0);
   assert.equal(localStorage.getItem('iband.creator-memory'),originalBytes);
   console.log('GREEN PHYSICAL_ASYNC_AUTHENTICATED_STUDIO_REAL_REACT_CALLER_READ_ONLY_NO_LOCAL_REBASE');
   await page.getByRole('button',{name:'Request verified editing'}).click();
   await poll(editable,'film-b | 4 | writable');
   await poll(continuity,'server-editable | film-b | writable');
   assert.equal(await selectionGate.admissions.countDocuments({projectId:'film-b'}),1);
   const f=(await selectionGate.admissions.findOne({projectId:'film-b',operationId:'adopt-film-b'})).fence;
   const forged=await sceneAuthority.save({token:process.env.INTRUDER_TOKEN,projectId:'film-b',operationId:'adopt-film-b:attack',fence:f,expectedRevision:4,scene:{id:'intruder',text:'intruder'}});
   assert.equal(forged.ok,false);
   const wrong=await sceneAuthority.save({token:process.env.OWNER_TOKEN,projectId:'film-a',operationId:'adopt-film-b:attack',fence:f,expectedRevision:1,scene:{id:'wrong',text:'wrong'}});
   assert.equal(wrong.ok,false);
   console.log('GREEN PHYSICAL_REAL_HANDLER_INTRUDER_CROSS_FILM_PRECOMMIT_DENIAL');
   assert.match(await local.textContent(),/film-b/);
   await page.getByRole('button',{name:'Creator handler turn'}).click();
   const messageDisplay=page.getByLabel('Creator message display');
   await poll(messageDisplay,'Continue Film B in real handler');
   await page.getByRole('button',{name:'Mentor handler scene'}).click();
   let committed=false;
   for(let n=0;n<100;n++){if(await receipts.countDocuments({projectId:'film-b',operationId:'adopt-film-b:creator-turn-new'})===1){committed=true;break}await delay(50)}
   assert.equal(committed,true,'Mongo receipt must exist before browser teardown');
   assert.equal((await projects.findOne({_id:'film-b'})).revision,5);
   assert.equal((await provenance.states.findOne({projectId:'film-b'})).revision,5);
   assert.equal(await provenance.ledger.countDocuments({projectId:'film-b'}),5);
   assert.equal(await selectionGate.readAdmission({token:process.env.OWNER_TOKEN,projectId:'film-b',operationId:'adopt-film-b',fence:f}),null,'prewrite admission snapshot must not be misrepresented as current revision after settlement');
   assert.equal(await page.evaluate(()=>Boolean(globalThis.__diagnosticConversationPending)),true);
   assert.equal((await page.getByLabel('Creator message display').textContent()).includes('Film B conversation scene'),false);
   assert.match(await local.textContent(),/film-b/);
   assert.equal(await receipts.countDocuments({projectId:'film-a'}),0);
   assert.equal(await grants.countDocuments({projectId:'film-b'}),0);
   console.log('GREEN PHYSICAL_REAL_HANDLER_ATOMIC_MONGO_SCENE_LEDGER_AND_RECEIPT');
   console.log('GREEN PHYSICAL_REAL_HANDLER_POSTCOMMIT_SOCKET_LOSS_PENDING_TURN_RETAINED');
   assert.equal(localStorage.getItem('iband.creator-memory'),originalBytes);
   console.log('GREEN PHYSICAL_ASYNC_AUTHENTICATED_STUDIO_FENCED_REAL_HANDLER_SETTLEMENT');
  }else{
   await poll(selected,'film-b | 2');
   assert.match(await local.textContent(),/film-a/);
   await page.getByLabel('Existing movie project ID').fill('film-b');
   await page.getByRole('button',{name:'Recover server-authorised film'}).click();
   await poll(continuity,'read-only | film-b | blocked');
   assert.equal(await page.evaluate(()=>globalThis.__applicationSecondFilmPhysicalCalls||0),0,'fresh browser must use read-only remount, never replay film switch');
   await poll(recovered,'Film B conversation scene');
   assert.match(await local.textContent(),/film-a/);
   assert.match(await editable.textContent(),/none/);
   const prior=await receipts.findOne({projectId:'film-b',operationId:'adopt-film-b:creator-turn-new'});
   assert.ok(prior?.fence);
   const readback=await sceneAuthority.readCommitted({token:process.env.OWNER_TOKEN,projectId:'film-b',operationId:'adopt-film-b:creator-turn-new'});
   assert.equal(readback?.revision,5);
   assert.equal(readback?.serverCommitId,prior.commitId);
   assert.equal(readback?.state.scenes.length,2);
   assert.equal(await sceneAuthority.readCommitted({token:process.env.INTRUDER_TOKEN,projectId:'film-b',operationId:'adopt-film-b:creator-turn-new'}),null);
   const replay=await sceneAuthority.save({token:process.env.OWNER_TOKEN,projectId:'film-b',operationId:'adopt-film-b:creator-turn-new',fence:prior.fence,expectedRevision:4,scene:prior.scene});
   assert.equal(replay.ok,true);
   assert.equal(replay.replay,true);
   const altered=await sceneAuthority.save({token:process.env.OWNER_TOKEN,projectId:'film-b',operationId:'adopt-film-b:creator-turn-new',fence:prior.fence,expectedRevision:4,scene:{id:'mentor-scene-new',text:'tamper'}});
   assert.equal(altered.ok,false);
   const stale=await sceneAuthority.save({token:process.env.OWNER_TOKEN,projectId:'film-b',operationId:'adopt-film-b:duplicate',fence:prior.fence,expectedRevision:4,scene:{id:'other',text:'duplicate'}});
   assert.equal(stale.ok,false);
   assert.equal(await receipts.countDocuments({projectId:'film-b'}),1);
   assert.equal(await provenance.ledger.countDocuments({projectId:'film-b'}),5);
   assert.equal((await projects.findOne({_id:'film-b'})).revision,5);
   assert.equal((await projects.findOne({_id:'film-a'})).revision,1);
   console.log('GREEN PHYSICAL_REAL_HANDLER_FRESH_BROWSER_READBACK_AND_EXACTLY_ONCE_REPLAY');
   console.log('GREEN PHYSICAL_REAL_HANDLER_TAMPER_STALE_AND_INTRUDER_DENIAL');
   assert.equal(localStorage.getItem('iband.creator-memory'),originalBytes);
   const deniedAgain=await restartedMemory.replaceStateWithSharedAuthority({locks:lockManager,transform:state=>({...state,journey:{...(state.journey||{}),activeProjectId:null}})});
   assert.equal(deniedAgain.acquired,false);
   assert.equal(deniedAgain.reason,'publication-outbox-provenance-unverified');
   assert.equal(localStorage.getItem('iband.creator-memory'),originalBytes);
   console.log('GREEN PHYSICAL_ASYNC_AUTHENTICATED_STUDIO_FRESH_BROWSER_READ_ONLY_REPLAY_AND_LOCAL_WRITER_LOCKED');
  }
  if(routeMode){
   // Rotate only after the existing save/recover assertions have completed.
   // No write is retried: explicitly read the committed film in the new session.
   const beforeReceipts=await receipts.countDocuments({projectId:'film-b'});
   const beforeLedger=await provenance.ledger.countDocuments({projectId:'film-b'});
   assert.notEqual(process.env.OWNER_TOKEN,process.env.RENEWED_OWNER_TOKEN);
   assert.ok(process.env.RENEWED_OWNER_TOKEN);
   const rotated=await page.evaluate(async token=>{
    globalThis.__routeOldServices=globalThis.__routeRetainedServices;
    globalThis.__diagnosticToken=token;
    try{await globalThis.__routeOldServices.request('/studio/read',{projectId:'film-b'});return false}
    catch(e){return e.message==='authenticated-session-rotated'}
   },process.env.RENEWED_OWNER_TOKEN);
   assert.equal(rotated,true);
   await page.waitForFunction(()=>globalThis.__routeSession.getServices()?.recoveryServices().token===globalThis.__diagnosticToken);
   await page.getByRole('heading',{name:/Welcome back, Diagnostic Creator/}).waitFor({timeout:15000});
   const renewed=await page.evaluate(async()=>{
    const app=globalThis.__routeSession.getServices();
    if(app.studioServices===globalThis.__routeOldServices||app.studioServices.pending!==null)throw Error('obsolete services or pending turn reused');
    return app.studioServices.request('/studio/read',{projectId:'film-b'});
   });
   assert.equal(renewed.ok,true);
   assert.equal(renewed.revision,5);
   assert.equal(renewed.state.scenes.length,2);
   assert.equal(await receipts.countDocuments({projectId:'film-b'}),beforeReceipts);
   assert.equal(await provenance.ledger.countDocuments({projectId:'film-b'}),beforeLedger);
   assert.equal(await page.evaluate(async()=>{try{await globalThis.__routeOldServices.request('/studio/read',{projectId:'film-b'});return false}catch{return true}}),true);
   console.log('GREEN PHYSICAL_ROUTED_SIGNED_MONGO_'+phase.toUpperCase()+'_RENEWED_TOKEN_READBACK_NO_DUPLICATE');
   await page.evaluate(()=>globalThis.__routeSignOut());
   await page.getByRole('status',{name:'Studio authority locked'}).waitFor({timeout:15000});
   assert.equal(await page.evaluate(async()=>{try{await globalThis.__routeRetainedServices.request('/studio/read',{projectId:'film-b'});return false}catch{return globalThis.__routeSession.getServices()===null}}),true);
   console.log('GREEN PHYSICAL_ROUTED_SIGNED_MONGO_'+phase.toUpperCase()+'_SIGNOUT_REVOKES_RETAINED_SERVICES');
  }
  assert.deepEqual(pageErrors,[]);
  if(routeMode){
   const discover=async(token,body)=>fetch('http://127.0.0.1:'+server.address().port+'/studio/selection-vault',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});
   const ownerProof=await discover(process.env.OWNER_TOKEN,{});
   assert.equal(ownerProof.status,200);
   assert.deepEqual(await ownerProof.json(),{ok:true,vaultId:selectionProjectId});
   assert.equal((await discover(process.env.INTRUDER_TOKEN,{})).status,403);
   assert.equal((await discover(process.env.OWNER_TOKEN,{vaultId:'foreign'})).status,400);
   await vaultBindings.updateOne({ownerId:'owner-1'},{$set:{revoked:true}});
   try{assert.equal((await discover(process.env.OWNER_TOKEN,{})).status,403);
    assert.equal((await vaultAuthority.provision({token:process.env.OWNER_TOKEN,vaultId:selectionProjectId})).ok,false);
    assert.equal(await vaultBindings.countDocuments({ownerId:'owner-1',revoked:true}),1);
    console.log('GREEN PHYSICAL_REVOKED_VAULT_CANNOT_BE_REPROVISIONED');
   }
   finally{await vaultBindings.updateOne({ownerId:'owner-1'},{$set:{revoked:false}});}
   console.log('GREEN PHYSICAL_SERVER_DERIVED_OWNER_VAULT_DISCOVERY_AND_DENIAL');
   if(phase==='recover'){
    // Independent, valid genesis vault for a second owner. Prove the write
    // reaches the actual commit seam before revocation wins; no sleeps.
    assert.equal((await vaultAuthority.revoke({token:process.env.INTRUDER_TOKEN})).ok,false);
    // Canonical creation uses a separate disposable principal so existing
    // fixture-backed ownership and intruder controls remain independent.
    // Inject an exception after all three writes but before transaction commit.
    const rollbackToken=process.env.ROLLBACK_OWNER_TOKEN;
    let attemptedVault,attemptsAtSeam=0;
    const faulted=createStudioOwnerVaultAuthority({bindings:vaultBindings,states:provenance.states,ledger:provenance.ledger,client,authenticateOwner:token=>authenticate('Bearer '+token),readSelection:selectionAuthority.read,beforeGenesisCommit:async({ownerId,vaultId})=>{
     assert.equal(ownerId,'rollback-owner');attemptedVault=vaultId;attemptsAtSeam++;
     throw Error('injected-vault-genesis-abort');
    }});
    await assert.rejects(()=>faulted.create({token:rollbackToken}),/injected-vault-genesis-abort/);
    assert.equal(attemptsAtSeam,1);assert.ok(attemptedVault);
    assert.equal(await vaultBindings.countDocuments({ownerId:'rollback-owner'}),0);
    assert.equal(await provenance.states.countDocuments({ownerId:'rollback-owner'}),0);
    assert.equal(await provenance.ledger.countDocuments({ownerId:'rollback-owner'}),0);
    assert.equal((await vaultAuthority.resolve({token:rollbackToken})).ok,false);
    console.log('GREEN PHYSICAL_CANONICAL_VAULT_GENESIS_ABORT_ROLLS_BACK_ALL_THREE_WRITES');
    const endpoint=async(token,body)=>fetch('http://127.0.0.1:'+server.address().port+'/studio/selection-vault-create',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});
    assert.equal((await endpoint('invalid',{})).status,401);
    for(const bad of [{vaultId:'foreign'},{ownerId:'owner-1'},{content:{projects:[]}},[],null])assert.equal((await endpoint(rollbackToken,bad)).status,400);
    assert.equal(await vaultBindings.countDocuments({ownerId:'rollback-owner'}),0);
    const retried=await endpoint(rollbackToken,{});
    assert.equal(retried.status,201);
    const recoveredGenesis=await retried.json();
    assert.equal(recoveredGenesis.ok,true);assert.notEqual(recoveredGenesis.vaultId,attemptedVault);
    const duplicate=await endpoint(rollbackToken,{});
    assert.equal(duplicate.status,200);assert.deepEqual(await duplicate.json(),{ok:true,vaultId:recoveredGenesis.vaultId,replayed:true});
    assert.equal(await vaultBindings.countDocuments({ownerId:'rollback-owner'}),1);
    assert.equal(await provenance.states.countDocuments({ownerId:'rollback-owner'}),1);
    assert.equal(await provenance.ledger.countDocuments({ownerId:'rollback-owner'}),1);
    assert.equal(await provenance.states.countDocuments({projectId:attemptedVault}),0);
    assert.equal(await provenance.ledger.countDocuments({projectId:attemptedVault}),0);
    assert.deepEqual(await vaultAuthority.resolve({token:rollbackToken}),{ok:true,vaultId:recoveredGenesis.vaultId});
    console.log('GREEN PHYSICAL_AUTHENTICATED_VAULT_CREATION_ENDPOINT_RETRY_AND_INPUT_DENIAL');
    const canonicalToken=process.env.CANONICAL_OWNER_TOKEN;
    assert.ok(canonicalToken);
    const created=await Promise.all(Array.from({length:3},()=>vaultAuthority.create({token:canonicalToken})));
    assert.ok(created.every(x=>x.ok===true));
    const canonicalVault=created[0].vaultId;
    assert.ok(created.every(x=>x.vaultId===canonicalVault));
    assert.equal(created.filter(x=>x.replayed===false).length,1);
    assert.equal(await vaultBindings.countDocuments({ownerId:'canonical-owner'}),1);
    assert.equal(await provenance.states.countDocuments({ownerId:'canonical-owner'}),1);
    assert.equal(await provenance.ledger.countDocuments({projectId:canonicalVault}),1);
    assert.deepEqual(await selectionAuthority.read({token:canonicalToken,projectId:canonicalVault}),{ok:true,projectId:canonicalVault,revision:1,activeProjectId:null});
    assert.equal((await selectionAuthority.read({token:process.env.OWNER_TOKEN,projectId:canonicalVault})).ok,false);
    assert.equal((await vaultAuthority.create({token:'invalid'})).ok,false);
    assert.equal((await vaultAuthority.revoke({token:canonicalToken})).ok,true);
    assert.equal((await vaultAuthority.create({token:canonicalToken})).ok,false);
    assert.equal(await provenance.states.countDocuments({ownerId:'canonical-owner'}),1);
    console.log('GREEN PHYSICAL_CANONICAL_VAULT_ATOMIC_GENESIS_CREATE_ONCE_AND_NON_RESURRECTION');
    const raceOwner='intruder',raceVault='isolated-new-write-race-vault',raceToken=process.env.INTRUDER_TOKEN;
    await provenance.states.insertOne({projectId:raceVault,ownerId:raceOwner,revision:0,ownershipRevision:1,revoked:false,state:{content:{activeProjectId:null,projects:[]},durablePublicationOutbox:[]}});
    const seed=await provenance.append({token:raceToken,projectId:raceVault,operationId:'race-genesis',expectedRevision:0,content:{activeProjectId:null,projects:[]}});
    assert.equal(seed.ok,true);
    assert.equal((await vaultAuthority.provision({token:raceToken,vaultId:raceVault})).ok,true);
    let arrived,release;
    const reached=new Promise(r=>arrived=r),resume=new Promise(r=>release=r);
    let gateCalls=0;
    const fenced=createServerProjectSelectionAuthority({gate:selectionGate,db,client,beforeSelectionCommit:async({operationId})=>{
     assert.equal(operationId,'race-new-write');
     gateCalls++;arrived();await resume;
    }});
    const request={token:raceToken,projectId:raceVault,operationId:'race-new-write',expectedRevision:1,nextActiveProjectId:null};
    const pending=fenced.select(request);
    let timer;
    try{
     await Promise.race([reached,pending.then(()=>{throw Error('new-write-denied-before-commit-seam')}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('new-write-commit-seam-timeout')),10000)})]);
     assert.equal((await vaultAuthority.revoke({token:raceToken})).ok,true);
    }finally{clearTimeout(timer);release();}
    assert.equal((await pending).ok,false);
    assert.equal(gateCalls,1);
    assert.equal(await selectionAuthority.receipts.countDocuments({projectId:raceVault}),0);
    const deniedState=await provenance.states.findOne({projectId:raceVault});
    assert.equal(deniedState.revision,1);
    assert.equal(deniedState.ownershipRevision,2);
    assert.equal(deniedState.revoked,true);
    assert.equal(await vaultBindings.countDocuments({ownerId:raceOwner,vaultId:raceVault,revoked:true}),1);
    console.log('GREEN PHYSICAL_NEW_SELECTION_WRITE_PAUSED_AT_COMMIT_REVOKED_NO_RECEIPT');
    const old=await selectionAuthority.receipts.findOne({projectId:selectionProjectId});
    assert.ok(old);
    const replay={token:process.env.OWNER_TOKEN,projectId:selectionProjectId,operationId:old.operationId,expectedRevision:old.expectedRevision,nextActiveProjectId:old.nextActiveProjectId};
    assert.equal((await selectionAuthority.select(replay)).ok,true);
    const count=await selectionAuthority.receipts.countDocuments({projectId:selectionProjectId});
    const [revocation]=await Promise.all([vaultAuthority.revoke({token:process.env.OWNER_TOKEN}),selectionAuthority.select(replay)]);
    assert.equal(revocation.ok,true);
    assert.deepEqual(await vaultAuthority.revoke({token:process.env.OWNER_TOKEN}),{ok:true,replayed:true});
    const invoke=async(path,body)=>fetch('http://127.0.0.1:'+server.address().port+path,{method:'POST',headers:{authorization:'Bearer '+process.env.OWNER_TOKEN,'content-type':'application/json'},body:JSON.stringify(body)});
    assert.equal((await discover(process.env.OWNER_TOKEN,{})).status,403);
    assert.equal((await invoke('/studio/selection-read',{projectId:selectionProjectId})).status,403);
    const {token,...body}=replay;
    assert.equal((await invoke('/studio/selection-change',body)).status,403);
    assert.equal((await invoke('/studio/selection-change',{...body,operationId:'post-revocation-new'})).status,403);
    assert.equal(await selectionAuthority.receipts.countDocuments({projectId:selectionProjectId}),count);
    assert.equal((await vaultAuthority.provision({token:process.env.OWNER_TOKEN,vaultId:selectionProjectId})).ok,false);
    assert.equal(await provenance.states.countDocuments({projectId:selectionProjectId,ownerId:'owner-1',revoked:true,ownershipRevision:2}),1);
    console.log('GREEN PHYSICAL_ATOMIC_VAULT_REVOCATION_RETAINED_TOKEN_AND_REPLAY_DENIAL');
   }
  }
  const intruder=await fetch('http://127.0.0.1:'+server.address().port+'/studio/read',{method:'POST',headers:{authorization:'Bearer '+process.env.INTRUDER_TOKEN,'content-type':'application/json'},body:JSON.stringify({projectId:'film-a'})});
  assert.equal(intruder.status,403);
  console.log('GREEN PHYSICAL_STUDIO_SELECTION_INTRUDER_DENIED');
  console.log('HELD ORIGINAL_FRONTEND_RED_AND_APPLICATION_MAIN_ADOPTION');
 } 
}finally{
 if(browser)await browser.close();
 if(vite){vite.kill('SIGTERM');for(let i=0;i<30&&vite.exitCode===null;i++)await delay(100);if(vite.exitCode===null)vite.kill('SIGKILL')}
 for(const f of files)rmSync(f,{force:true});
 if(server?.listening)await new Promise(resolve=>server.close(resolve));
 await client.close();
}
