// Physical integration with unchanged pinned native ingress and registry.
import assert from 'node:assert/strict';
import {randomUUID,generateKeyPairSync,sign,verify,createPublicKey,createHash} from 'node:crypto';
import express from 'express';
import http from 'node:http';
import {createMovieMentorCreatorRequestAuthority} from './ai/MovieMentorCreatorRequestAuthority.js';
import {createMovieMentorTurnRouter} from './movieMentorTurn.js';
import {createMovieMentorProductionInferenceSpendComposition} from './ai/MovieMentorProductionInferenceSpendComposition.js';
import {createMovieMentorProductionInferenceExecutionComposition} from './ai/MovieMentorProductionInferenceExecutionComposition.js';
import {createMovieMentorInferenceSettlementMongoStore} from './ai/MovieMentorInferenceSettlementMongoStore.js';
import {createMovieMentorInferenceSettlementReconciliationAuthority} from './ai/MovieMentorInferenceSettlementReconciliationAuthority.js';
import {buildRequestDigest} from './ai/MovieMentorTurnRuntime.js';
import {MOVIE_MENTOR_INFERENCE_EXECUTION_REQUIRED_UNIQUE_INDEXES as EXECUTION_REQUIRED} from './ai/MovieMentorInferenceExecutionPhysicalAuthority.js';
import {MOVIE_MENTOR_INFERENCE_SETTLEMENT_REQUIRED_UNIQUE_INDEXES as SETTLEMENT_REQUIRED} from './ai/MovieMentorInferenceSettlementPhysicalAuthority.js';
import {createPhysicalProvenanceFencedSceneSettlement} from './isolated-physical-provenance-fenced-scene-settlement.mjs';
import {spawnSync,spawn} from 'node:child_process';
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {createApplicationStudioSessionFactory} from './isolated-application-studio-session-factory.mjs';
import mongoose from 'mongoose';
import {MongoClient} from 'mongodb';
import {createMovieMentorProjectsRouter} from './movieMentorProjects.js';
import {createMovieMentorNativeProjectCreationAuthority} from './ai/MovieMentorNativeProjectCreationAuthority.js';
import {createMovieMentorProjectOwnershipAuthority} from './ai/MovieMentorProjectOwnershipRegistry.js';
import {createProvenanceAuthority} from './isolated-server-publication-provenance.mjs';
import {createWritableAdmissionGate} from './isolated-writable-admission-gate.mjs';
import {createServerProjectSelectionAuthority} from './isolated-server-original-red-project-selection.mjs';
import {createStudioOwnerVaultAuthority} from './isolated-studio-owner-vault-authority.mjs';
import {createNativeFilmRegistration} from './isolated-native-film-registration.mjs';
const uri=process.env.MONGO_URI;
assert.match(uri,/^mongodb:\/\/127\.0\.0\.1:27017\//);
const client=new MongoClient(uri);await client.connect();
const db=client.db('isolated_native_film_registration');
const {publicKey,privateKey}=process.env.NATIVE_RECOVERY_PUBLIC_KEY?{publicKey:createPublicKey(process.env.NATIVE_RECOVERY_PUBLIC_KEY),privateKey:null}:generateKeyPairSync('rsa',{modulusLength:2048});
const now=Math.floor(Date.now()/1000),b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const issuer='https://isolated-auth.test',audience='movie-mentor-creator-write';
function jwt(sub){const data=b64({alg:'RS256',typ:'JWT'})+'.'+b64({iss:issuer,aud:audience,sub,iat:now,nbf:now-1,exp:now+600});return data+'.'+sign('RSA-SHA256',Buffer.from(data),privateKey).toString('base64url')}
function authenticate(token){try{const [h,p,s]=token.split('.');const claims=JSON.parse(Buffer.from(p,'base64url'));return JSON.parse(Buffer.from(h,'base64url')).alg==='RS256'&&verify('RSA-SHA256',Buffer.from(h+'.'+p),publicKey,Buffer.from(s,'base64url'))&&claims.iss===issuer&&claims.aud===audience&&claims.exp>Math.floor(Date.now()/1000)&&claims.nbf<=Math.floor(Date.now()/1000)?claims.sub:null}catch{return null}}
const ownerId=process.env.NATIVE_RECOVERY_OWNER_ID||'native-owner-'+randomUUID(),owner=process.env.NATIVE_RECOVERY_OWNER_TOKEN||jwt(ownerId),foreign=process.env.NATIVE_RECOVERY_FOREIGN_TOKEN||jwt('foreign');
let server;
try{
 await mongoose.connect(uri,{autoIndex:false});
 const registry=mongoose.connection.collection('movie_mentor_project_ownership');
 await registry.createIndex({projectId:1},{unique:true});
 await registry.createIndex({establishmentAuthorityId:1},{unique:true});
 const ownershipAuthority=createMovieMentorProjectOwnershipAuthority();
 const nativeProjectCreationAuthority=createMovieMentorNativeProjectCreationAuthority({ownershipAuthority,expectedIssuer:issuer,expectedAudience:audience,verifyCredential:async({credential})=>{
  const subject=authenticate(credential);if(!subject)throw Error('invalid token');
  return {verified:true,subject,issuer,audience,verificationMethod:'RS256-test',verificationVersion:'1',authenticatedAt:new Date(now*1000),expiresAt:new Date((now+600)*1000),active:true,revoked:false};
 }});
 const provenance=createProvenanceAuthority({db,client,publicKey});
 const gate=createWritableAdmissionGate({db,client,publicKey});
 const selection=createServerProjectSelectionAuthority({gate,db,client});
 const bindings=db.collection('studio_owner_vault_bindings'),projects=db.collection('projects');
 const vaults=createStudioOwnerVaultAuthority({bindings,states:provenance.states,ledger:provenance.ledger,client,authenticateOwner:authenticate,readSelection:selection.read});
 await vaults.initialize();await selection.receipts.createIndex({projectId:1,operationId:1},{unique:true});
 const registration=createNativeFilmRegistration({client,states:provenance.states,ledger:provenance.ledger,bindings,projects,ownershipAuthority,authenticateOwner:authenticate});
 const receipts=db.collection('native_conversation_receipts');
 await receipts.createIndex({projectId:1,operationId:1},{unique:true});await receipts.createIndex({projectId:1,creatorTurnId:1},{unique:true});
 const settlement=createPhysicalProvenanceFencedSceneSettlement({client,gate,projects,receipts});
 const app=express();app.use(express.json());app.use('/api/movie-mentor',createMovieMentorProjectsRouter({nativeProjectCreationAuthority}));
 app.post('/studio/native-film-register',async(req,res)=>res.json(await registration.register({token:req.get('authorization')?.replace(/^Bearer /,''),projectId:req.body.projectId})));
 app.post('/studio/selection-vault',async(req,res)=>res.json(await vaults.resolve({token:req.get('authorization')?.replace(/^Bearer /,'')})));
 app.post('/studio/selection-read',async(req,res)=>res.json(await selection.read({...req.body,token:req.get('authorization')?.replace(/^Bearer /,'')})));
 app.post('/studio/selection-change',async(req,res)=>res.json(await selection.select({...req.body,token:req.get('authorization')?.replace(/^Bearer /,'')})));
 app.post('/studio/read',async(req,res)=>{
  const sub=authenticate(req.get('authorization')?.replace(/^Bearer /,''));
  const projectId=req.body.projectId;
  if(!sub)return res.json({ok:false});
  const proof=await ownershipAuthority.authorizeProject({principal:{authenticated:true,principalId:sub},projectId});
  if(proof?.authorized!==true)return res.json({ok:false});
  const p=await projects.findOne({_id:projectId,ownerId:sub});
  const canonical=await provenance.states.findOne({projectId,ownerId:sub,revoked:false});
  const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
  if(!p||!canonical||p.revision!==canonical.revision||hash(p.state)!==hash(canonical.state.content))return res.json({ok:false});
  const records=await provenance.ledger.find({projectId,ownerId:sub,ownershipRevision:canonical.ownershipRevision},{ }).sort({revision:1}).toArray();
  const outbox=canonical.state.durablePublicationOutbox;
  if(!Array.isArray(outbox)||!records.length||records.length!==outbox.length||records.some((r,i)=>hash(r.entry)!==hash(outbox[i]))||records.at(-1).stateDigest!==hash(canonical.state)||records.at(-1).fullOutboxDigest!==hash(outbox))return res.json({ok:false});
  return res.json({ok:true,projectId:p._id,revision:p.revision,state:p.state});
 });
 app.post('/studio/publication-grant',async(req,res)=>{
  const {projectId,revision}=req.body;
  const grant=await provenance.issue({projectId,revision,token:req.get('authorization')?.replace(/^Bearer /,'')});
  return res.json(grant?.grantId?{grantId:grant.grantId,projectId,revision}:null);
 });
 app.post('/studio/admit-publication',async(req,res)=>res.json(await gate.admit({...req.body,token:req.get('authorization')?.replace(/^Bearer /,'')})));
 app.post('/studio/read-admission',async(req,res)=>res.json(await gate.readAdmission({...req.body,token:req.get('authorization')?.replace(/^Bearer /,'')})));
 app.post('/studio/native-conversation-receipt',async(req,res)=>res.json(await settlement.readConversationReceipt({...req.body,token:req.get('authorization')?.replace(/^Bearer /,'')})));
 app.post('/studio/native-conversation-retire',async(req,res)=>res.json(await settlement.retireConversationWriter({...req.body,token:req.get('authorization')?.replace(/^Bearer /,'')})));
 app.post('/studio/native-conversation-recover',async(req,res)=>res.json(await settlement.recoverInterruptedConversation({...req.body,token:req.get('authorization')?.replace(/^Bearer /,'')})));
 app.post('/studio/native-conversation-cancel',async(req,res)=>res.json(await settlement.cancelUncommittedConversation({...req.body,token:req.get('authorization')?.replace(/^Bearer /,'')})));
 let dropNextConversationAck=false,droppedAcks=0;
 app.post('/studio/native-conversation-settle',async(req,res)=>{
  const result=await settlement.settleConversation({...req.body,token:req.get('authorization')?.replace(/^Bearer /,'')});
  if(dropNextConversationAck&&result.ok&&!result.replay){dropNextConversationAck=false;droppedAcks++;res.socket.destroy();return;}
  return res.json(result);
 });
 server=app.listen(0,'127.0.0.1');await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject)});
 if(process.env.NATIVE_RECOVERY_PUBLIC_KEY){
  const expected=JSON.parse(process.env.EXPECTED_CONVERSATIONS);
  const transport=async({path,token,body})=>{const r=await fetch('http://127.0.0.1:'+server.address().port+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});return r.json()};
  const views=[];
  const factory=createApplicationStudioSessionFactory({transport,resolveSelectionVaultId:async({token})=>(await vaults.resolve({token})).vaultId,readLocalBytes:()=>'unchanged-local-bytes',onView:x=>views.push(x)});
  const session=factory({getAuthToken:async()=>owner}),opened=await session.open();assert.equal(opened.ok,true);
  const vaultId=(await vaults.resolve({token:owner})).vaultId;
  for(const x of [...expected].reverse()){
   assert.equal((await transport({path:'/studio/read',token:foreign,body:{projectId:x.projectId}})).ok,false);
   const current=await selection.read({token:owner,projectId:vaultId});
   const recovered=current.activeProjectId===x.projectId?
    await opened.services.applicationSecondFilm.reopen({token:owner,selectionVaultId:vaultId,projectId:x.projectId}):
    await opened.services.applicationSecondFilm.choose({token:owner,selectionVaultId:vaultId,nextProjectId:x.projectId,selectionOperationId:'restart-select-'+x.projectId,localMemory:{getState:()=>({})}});
   assert.equal(recovered.ok,true,JSON.stringify(recovered));
   assert.equal(recovered.view.writable,false);
   assert.deepEqual(recovered.view.conversationMessages,[x.creatorMessage,x.mentorMessage]);
   assert.deepEqual(views.at(-1).conversationMessages,[x.creatorMessage,x.mentorMessage]);
   assert.equal(await receipts.countDocuments({projectId:x.projectId}),1);
  }
  // Mount the pinned component with a restricted native read-only caller candidate.
  // Do not expose the old cockpit's local-write controls in this candidate.
  const base='native_conversation_recovery_'+randomUUID().replaceAll('-','');
  const root='../frontend/',component=root+'src/components/studio/'+base+'.jsx',entry=root+base+'.jsx',html=root+base+'.html',config=root+base+'.config.mjs';
  const files=[component,entry,html,config];
  let browser,vite;
  try{
   let source=readFileSync(root+'src/components/studio/CreatorWorkspace.jsx','utf8');
   function exact(from,to){assert.equal(source.split(from).length,2,'pinned native source drift: '+from);source=source.replace(from,to)}
   exact('import React, { useEffect, useMemo, useState }','import React, { useEffect, useMemo, useState, useRef }');
   exact('const CreatorWorkspace = ({ creatorName = "Creator",','const CreatorWorkspace = ({ nativeMovieService, creatorName = "Creator",');
   exact('const [movieMessages, setMovieMessages] = useState(resumeSnapshot?.conversationMessages || []);','const [movieMessages, setMovieMessages] = useState(nativeMovieService ? [] : resumeSnapshot?.conversationMessages || []);');
   exact('if (!resumeSnapshot?.projectId) return undefined;','if (nativeMovieService || !resumeSnapshot?.projectId) return undefined;');
   const anchor='  const activeCreator = useMemo(';
   exact(anchor,`  const nativeEpoch=useRef(0), nativePending=useRef(null);
  const [nativeProject,setNativeProject]=useState(null);
  const [nativeBusy,setNativeBusy]=useState(false);
  const [nativeError,setNativeError]=useState("");
  const [nativeWritable,setNativeWritable]=useState(false);
  const [nativeText,setNativeText]=useState("");
  const recoverNative=async(action,target)=>{
    const epoch=++nativeEpoch.current;
    setNativeBusy(true);setNativeError("");setMovieMessages([]);setNativeProject(null);setNativeWritable(false);
    try{
      const result=await nativeMovieService.run(action,target);
      if(epoch!==nativeEpoch.current)return;
      if(!result?.ok||!["read-only","server-editable"].includes(result.view?.mode)||!Array.isArray(result.view.conversationMessages))throw Error("native recovery denied");
      setNativeProject(result.view.projectId);setMovieMessages(result.view.conversationMessages);setNativeWritable(result.view.writable===true&&result.view.serverOwned===true);
      if(action==="create")nativePending.current=null;
    }catch{if(epoch===nativeEpoch.current)setNativeError("Movie recovery unavailable");}
    finally{if(epoch===nativeEpoch.current)setNativeBusy(false);}
  };
  useEffect(()=>{
    if(!nativeMovieService)return undefined;
    void recoverNative("resume");
    return ()=>{nativeEpoch.current++;};
  },[nativeMovieService]);
  const createNative=()=>{
    if(!nativePending.current){
      const id=globalThis.crypto?.randomUUID?.();
      if(!id){setNativeError("Secure identity unavailable");return;}
      nativePending.current="movie-project-"+id;
    }
    void recoverNative("create",nativePending.current);
  };
`+anchor);
   const render='  return (\n    <main style={styles.workspace}>';
   exact(render,`  if(nativeMovieService)return <main style={styles.workspace}>
    <h1>AI Movie Making</h1>
    <section aria-label="Recover an existing Movie Mentor project">
      <input aria-label="Existing movie project ID" value={recoveryProjectId} onChange={e=>{nativeEpoch.current++;setNativeBusy(false);setNativeProject(null);setMovieMessages([]);setNativeWritable(false);setRecoveryProjectId(e.target.value);}}/>
      <button type="button" disabled={nativeBusy} onClick={()=>void recoverNative("choose",recoveryProjectId.trim())}>Recover server-authorised film</button>
      <button type="button" disabled={nativeBusy} onClick={createNative}>Create new movie</button>
      <output aria-label="Verified native movie">{nativeProject||"none"}</output>
      <p>{nativeWritable?"Server writer admitted":"Read-only recovery. Editing remains blocked."}</p>
      <button type="button" disabled={nativeBusy||!nativeProject||nativeWritable} onClick={()=>void recoverNative("admit")}>Request native writing</button>
      <input aria-label="Native creator message" disabled={!nativeWritable||nativeBusy} value={nativeText} onChange={e=>setNativeText(e.target.value)}/>
      <button type="button" disabled={!nativeWritable||nativeBusy||!nativeText.trim()} onClick={()=>{const id=globalThis.crypto.randomUUID();void recoverNative("submit",{creatorMessage:{id,role:"creator",text:nativeText},mentorMessage:{id:globalThis.crypto.randomUUID(),role:"mentor",text:"Diagnostic mentor response",metadata:{backendMetadata:{creatorTurnId:id}}}});}}>Settle native conversation</button>
      {nativeError&&<p role="alert">{nativeError}</p>}
      <ol aria-label="Restored conversation">{movieMessages.map((m,i)=><li key={m.id||i}>{m.role}: {m.text}</li>)}</ol>
    </section>
  </main>;
`+render);
   writeFileSync(component,source);
   writeFileSync(entry,`import React from 'react';import {createRoot} from 'react-dom/client';import CreatorWorkspace from './src/components/studio/${base}.jsx';const nativeMovieService={run:(action,target)=>globalThis.nativeMovieRun(action,target)};createRoot(document.getElementById('root')).render(<CreatorWorkspace nativeMovieService={nativeMovieService}/>);`);
   writeFileSync(html,`<html><body><div id="root"></div><script type="module" src="/${base}.jsx"></script></body></html>`);
   writeFileSync(config,`import {defineConfig} from 'vite';import react from '@vitejs/plugin-react-swc';export default defineConfig({plugins:[react()]});`);
   vite=spawn('./node_modules/.bin/vite',['--host','127.0.0.1','--port','52769','--strictPort','--config',base+'.config.mjs'],{cwd:root,stdio:['ignore','pipe','pipe']});
   let errors='';vite.stdout.on('data',x=>errors+=x);vite.stderr.on('data',x=>errors+=x);
   const url='http://127.0.0.1:52769/'+base+'.html';
   let ready=false;for(let i=0;i<100;i++){try{if((await fetch(url)).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,150))}
   assert.ok(ready,errors);
   const {chromium}=await import('playwright');browser=await chromium.launch({headless:true});
   const page=await browser.newPage();
   let browserSession=null;
   await page.exposeFunction('nativeMovieRun',async(action,target)=>{
    if(action==='resume'||!browserSession){browserSession?.invalidate();browserSession=factory({getAuthToken:async()=>owner});const r=await browserSession.open();if(!r.ok)return r}
    const app=browserSession.getServices();if(!app)return {ok:false};
    if(action==='admit'){
     const admitted=await app.applicationSecondFilm.requestEditing({token:owner,selectionVaultId:vaultId,operationId:'browser-admit-'+randomUUID()});
     assert.equal(admitted.ok,true,'native browser admission: '+JSON.stringify(admitted));
     return admitted;
    }
    if(action==='submit'){
     const settled=await app.submitNativeConversation(target);
     assert.equal(settled.ok,true,'native browser settlement: '+JSON.stringify(settled));
     return settled;
    }
    if(action==='create')return app.createNativeFilm({projectId:target,operationId:'browser-create-'+target});
    const current=await selection.read({token:owner,projectId:vaultId});
    const id=action==='resume'?current.activeProjectId:target;
    return current.activeProjectId===id?app.resumeNativeConversation({projectId:id}):app.applicationSecondFilm.choose({token:owner,selectionVaultId:vaultId,nextProjectId:id,selectionOperationId:'browser-switch-'+randomUUID(),localMemory:{getState:()=>({})}});
   });
   const poll=async(locator,expected)=>{for(let i=0;i<100;i++){if(await locator.count()&&(await locator.textContent())?.includes(expected))return;await new Promise(r=>setTimeout(r,100))}throw Error('browser projection missing '+expected+'; visible body: '+await page.locator('body').innerText())};
   await page.goto(url);
   const display=page.getByLabel('Restored conversation'),identity=page.getByLabel('Verified native movie');
   const first=expected[0],second=expected[1];
   await poll(identity,first.projectId);await poll(display,first.creatorMessage.text);
   await page.getByLabel('Existing movie project ID').fill(second.projectId);
   assert.equal(await display.textContent(),'');
   await page.getByRole('button',{name:'Recover server-authorised film'}).click();
   await poll(identity,second.projectId);await poll(display,second.mentorMessage.text);
   assert.ok(!(await display.textContent()).includes(first.creatorMessage.text));
   await page.reload();await poll(identity,second.projectId);await poll(display,second.creatorMessage.text);
   await page.getByRole('button',{name:'Create new movie'}).click();
   for(let i=0;i<100;i++){const id=await identity.textContent();if(id.startsWith('movie-project-')&&id!==second.projectId&&id!==first.projectId)break;await new Promise(r=>setTimeout(r,100))}
   const created=await identity.textContent();assert.match(created,/^movie-project-/);assert.notEqual(created,first.projectId);assert.notEqual(created,second.projectId);assert.equal(await display.textContent(),'');
   assert.equal(await registry.countDocuments({projectId:created}),1);
   await page.reload();await poll(identity,created);assert.equal(await display.textContent(),'');
   await page.getByRole('button',{name:'Request native writing'}).click();
   await poll(page.getByText('Server writer admitted',{exact:true}),'Server writer admitted');
   await page.getByLabel('Native creator message').fill('Native browser conversation');
   await page.getByRole('button',{name:'Settle native conversation'}).click();
   await poll(display,'Native browser conversation');await poll(display,'Diagnostic mentor response');
   const browserReceipt=await receipts.findOne({projectId:created});assert.ok(browserReceipt?.commitId);
   assert.equal(await receipts.countDocuments({projectId:created}),1);
   const unchangedSelection=await selection.read({token:owner,projectId:vaultId});
   const firstRetired=await gate.admissions.findOne({projectId:created,fence:browserReceipt.fence});assert.equal(firstRetired.status,'retired');
   await page.getByRole('button',{name:'Request native writing'}).click();await poll(page.getByText('Server writer admitted',{exact:true}),'Server writer admitted');
   dropNextConversationAck=true;
   await page.getByLabel('Native creator message').fill('Same film lost acknowledgement');
   await page.getByRole('button',{name:'Settle native conversation'}).click();await poll(display,'Same film lost acknowledgement');
   assert.equal(droppedAcks,1);
   assert.equal(await receipts.countDocuments({projectId:created}),2);
   assert.deepEqual(await selection.read({token:owner,projectId:vaultId}),unchangedSelection);
   const sameFilm=await projects.findOne({_id:created});assert.equal(sameFilm.revision,3);assert.equal(sameFilm.state.conversationMessages.length,4);
   const laterReceipt=await receipts.findOne({projectId:created,revision:3});assert.ok(laterReceipt);assert.notEqual(laterReceipt.fence,browserReceipt.fence);
   const stale={projectId:created,selectionVaultId:vaultId,operationId:browserReceipt.admissionId+':same-film-stale',creatorTurnId:'same-film-stale',expectedRevision:3,fence:browserReceipt.fence,creatorMessage:{id:'same-film-stale',role:'creator',text:'stale'},mentorMessage:{id:'same-film-stale-mentor',role:'mentor',text:'stale',metadata:{backendMetadata:{creatorTurnId:'same-film-stale'}}}};
   assert.equal((await transport({path:'/studio/native-conversation-settle',token:owner,body:stale})).ok,false);
   assert.equal((await transport({path:'/studio/native-conversation-retire',token:foreign,body:{projectId:created,selectionVaultId:vaultId,operationId:laterReceipt.operationId,fence:laterReceipt.fence,serverCommitId:laterReceipt.commitId}})).ok,false);
   await page.reload();await poll(identity,created);await poll(display,'Native browser conversation');
   await page.getByLabel('Existing movie project ID').fill(first.projectId);
   await page.getByRole('button',{name:'Recover server-authorised film'}).click();await poll(identity,first.projectId);await poll(display,first.mentorMessage.text);
   assert.ok(!(await display.textContent()).includes(second.creatorMessage.text));
   const retired=await gate.admissions.findOne({projectId:created,fence:browserReceipt.fence});assert.equal(retired.status,'retired');
   await page.getByLabel('Existing movie project ID').fill(created);
   await page.getByRole('button',{name:'Recover server-authorised film'}).click();await poll(identity,created);await poll(display,'Native browser conversation');
   const oldWrite={projectId:created,selectionVaultId:vaultId,operationId:browserReceipt.admissionId+':stale',creatorTurnId:'stale',expectedRevision:2,fence:browserReceipt.fence,creatorMessage:{id:'stale',role:'creator',text:'stale'},mentorMessage:{id:'stale-mentor',role:'mentor',text:'stale',metadata:{backendMetadata:{creatorTurnId:'stale'}}}};
   assert.equal((await transport({path:'/studio/native-conversation-settle',token:owner,body:oldWrite})).ok,false);
   await page.getByRole('button',{name:'Request native writing'}).click();await poll(page.getByText('Server writer admitted',{exact:true}),'Server writer admitted');
   await page.getByLabel('Native creator message').fill('Renewed native conversation');
   await page.getByRole('button',{name:'Settle native conversation'}).click();await poll(display,'Renewed native conversation');
   assert.equal(await receipts.countDocuments({projectId:created}),3);
   assert.equal((await projects.findOne({_id:created})).state.conversationMessages.length,6);
   // Commit through HTTP, destroy the acknowledgement and discard the old application
   // session before its receipt/retirement path can run. No pending input is passed
   // into the next session. The actual pinned browser reload supplies only selection.
   await page.getByRole('button',{name:'Request native writing'}).click();await poll(page.getByText('Server writer admitted',{exact:true}),'Server writer admitted');
   const stranded=browserSession.getServices().getContinuity();
   const turn=randomUUID(),interrupted={projectId:created,selectionVaultId:vaultId,operationId:stranded.operationId+':'+turn,creatorTurnId:turn,expectedRevision:4,fence:stranded.fence,creatorMessage:{id:turn,role:'creator',text:'Interrupted session committed conversation'},mentorMessage:{id:randomUUID(),role:'mentor',text:'Durable interrupted mentor response',metadata:{backendMetadata:{creatorTurnId:turn}}}};
   assert.equal((await transport({path:'/studio/native-conversation-recover',token:owner,body:{projectId:created,selectionVaultId:vaultId}})).reason,'unsettled-writer-held');
   dropNextConversationAck=true;
   await assert.rejects(transport({path:'/studio/native-conversation-settle',token:owner,body:interrupted}));
   assert.equal(droppedAcks,2);
   assert.equal(await receipts.countDocuments({projectId:created}),4);
   assert.equal((await gate.admissions.findOne({projectId:created,fence:stranded.fence})).status,'admitted');
   assert.equal((await transport({path:'/studio/native-conversation-recover',token:foreign,body:{projectId:created,selectionVaultId:vaultId}})).ok,false);
   browserSession.invalidate();browserSession=null;
   await page.reload();await poll(identity,created);await poll(display,'Interrupted session committed conversation');await poll(display,'Durable interrupted mentor response');
   assert.equal((await gate.admissions.findOne({projectId:created,fence:stranded.fence})).status,'retired');
   assert.equal(await receipts.countDocuments({projectId:created}),4);
   const again=await browserSession.getServices().resumeNativeConversation({projectId:created});assert.equal(again.ok,true);assert.equal(again.recovered,false);
   assert.equal((await transport({path:'/studio/native-conversation-settle',token:owner,body:interrupted})).ok,false);
   await page.getByRole('button',{name:'Request native writing'}).click();await poll(page.getByText('Server writer admitted',{exact:true}),'Server writer admitted');
   await page.getByLabel('Native creator message').fill('Fresh session continuation');
   await page.getByRole('button',{name:'Settle native conversation'}).click();await poll(display,'Fresh session continuation');
   assert.equal(await receipts.countDocuments({projectId:created}),5);
   const finalProject=await projects.findOne({_id:created});assert.equal(finalProject.revision,6);assert.equal(finalProject.state.conversationMessages.length,10);
   console.log('GREEN PHYSICAL_NATIVE_INTERRUPTED_SESSION_DURABLE_RECEIPT_RECONSTRUCTION_AND_CONTINUATION');
   // Distinguish a never-committed admission from a completed stranded writer.
   // A fresh session must not automatically cancel; explicit cancellation is
   // revision-fenced and a delayed request from the retired writer must fail.
   await page.getByRole('button',{name:'Request native writing'}).click();await poll(page.getByText('Server writer admitted',{exact:true}),'Server writer admitted');
   const abandoned=browserSession.getServices().getContinuity(),abandonedTurn=randomUUID();
   const abandonedWrite={projectId:created,selectionVaultId:vaultId,operationId:abandoned.operationId+':'+abandonedTurn,creatorTurnId:abandonedTurn,expectedRevision:6,fence:abandoned.fence,creatorMessage:{id:abandonedTurn,role:'creator',text:'Never committed'},mentorMessage:{id:randomUUID(),role:'mentor',text:'Never committed response',metadata:{backendMetadata:{creatorTurnId:abandonedTurn}}}};
   const beforeCancel=await selection.read({token:owner,projectId:vaultId});
   const cancellation={projectId:created,selectionVaultId:vaultId,expectedSelectionRevision:beforeCancel.revision,expectedRevision:6,confirmCancellation:true};
   browserSession.invalidate();browserSession=null;
   await page.reload();await poll(page.getByRole('alert'),'Movie recovery unavailable');
   const fresh=browserSession.getServices();assert.ok(fresh);
   assert.equal((await gate.admissions.findOne({projectId:created,fence:abandoned.fence})).status,'admitted');
   assert.equal((await fresh.cancelNativeUncommittedConversation({projectId:created})).ok,false);
   assert.equal((await transport({path:'/studio/native-conversation-cancel',token:foreign,body:cancellation})).ok,false);
   assert.equal((await transport({path:'/studio/native-conversation-cancel',token:owner,body:{...cancellation,expectedRevision:5}})).ok,false);
   const cancelled=await fresh.cancelNativeUncommittedConversation({projectId:created,confirmCancellation:true});
   assert.equal(cancelled.ok,true,JSON.stringify(cancelled));assert.equal(cancelled.view.writable,false);
   assert.equal((await gate.admissions.findOne({projectId:created,fence:abandoned.fence})).retirementReason,'explicit-uncommitted-conversation-cancellation');
   assert.deepEqual(await projects.findOne({_id:created}),finalProject);
   assert.equal(await receipts.countDocuments({projectId:created}),5);
   assert.equal((await transport({path:'/studio/native-conversation-settle',token:owner,body:abandonedWrite})).ok,false);
   await page.reload();await poll(identity,created);await poll(display,'Fresh session continuation');
   await page.getByRole('button',{name:'Request native writing'}).click();await poll(page.getByText('Server writer admitted',{exact:true}),'Server writer admitted');
   await page.getByLabel('Native creator message').fill('After explicit cancellation');
   await page.getByRole('button',{name:'Settle native conversation'}).click();await poll(display,'After explicit cancellation');
   assert.equal(await receipts.countDocuments({projectId:created}),6);
   assert.equal((await projects.findOne({_id:created})).revision,7);
   assert.equal((await projects.findOne({_id:created})).state.conversationMessages.length,12);
   assert.equal((await transport({path:'/studio/native-conversation-settle',token:owner,body:abandonedWrite})).ok,false);
   console.log('GREEN PHYSICAL_NATIVE_EXPLICIT_UNCOMMITTED_CANCELLATION_AND_STALE_WRITER_DENIAL');
   console.log('GREEN PHYSICAL_NATIVE_SAME_FILM_RENEWAL_AND_LOST_HTTP_ACK_RECEIPT_RECOVERY');
   browserSession?.invalidate();
   // Preserve the original Node-owned court above. Mount a second, genuinely
   // browser-owned composition through the pinned App /studio route.
   await page.close();
   const modules=['isolated-studio-server-selection-adoption.mjs','isolated-application-recovery-adoption-boundary.mjs','isolated-application-editable-adoption-boundary.mjs','isolated-studio-continuity-migration-candidate.mjs','isolated-application-owned-second-film-boundary.mjs','isolated-original-continuity-second-film-migration.mjs','isolated-application-owned-studio-service-composition.mjs','isolated-application-studio-async-clerk-session-adapter.mjs','isolated-application-studio-session-factory.mjs'];
   for(const module of modules){const dest=root+base+'_'+module;files.push(dest);let content=readFileSync('./'+module,'utf8');for(const dependency of modules)content=content.replaceAll("'./"+dependency+"'","'./"+base+'_'+dependency+"'");writeFileSync(dest,content)}
   const appPath=root+'src/'+base+'_App.jsx',shellPath=root+'src/components/studio/mentor/StudioRouteAuthorityShell.jsx',lifecyclePath=root+'src/components/studio/mentor/MovieMentorStudioRouteLifecycle.mjs';
   files.push(appPath,shellPath,lifecyclePath);
   const {transformPinnedStudioRouteToAuthorityShell}=await import('../scripts/isolated-pinned-studio-route-authority-candidate.mjs');
   let pinnedApp=transformPinnedStudioRouteToAuthorityShell(readFileSync(root+'src/App.jsx','utf8'));
   const shellImport='import StudioRouteAuthorityShell from "./components/studio/mentor/StudioRouteAuthorityShell.jsx";';
   assert.equal(pinnedApp.split(shellImport).length,2);
   pinnedApp=pinnedApp.replace(shellImport,shellImport+'\nimport {createRouteSession,RouteWorkspace} from "../'+base+'.jsx";');
   const route='element={<StudioRouteAuthorityShell onGenerate={generateMovieMentorLiveResponse} />}';
   assert.equal(pinnedApp.split(route).length,2);
   writeFileSync(appPath,pinnedApp.replace(route,'element={<StudioRouteAuthorityShell onGenerate={generateMovieMentorLiveResponse} createSession={createRouteSession} WorkspaceComponent={RouteWorkspace} />}'));
   writeFileSync(shellPath,readFileSync('../scripts/isolated-studio-route-authority-react-shell.jsx','utf8'));
   writeFileSync(lifecyclePath,readFileSync('../scripts/isolated-studio-authority-route-lifecycle.mjs','utf8'));
   writeFileSync(entry,`import React,{useMemo} from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter} from 'react-router-dom';import App from './src/${base}_App.jsx';import CreatorWorkspace from './src/components/studio/${base}.jsx';import {createApplicationStudioSessionFactory} from './${base}_isolated-application-studio-session-factory.mjs';import {setMovieMentorCreatorAuthState,clearMovieMentorCreatorAuthState} from './src/components/studio/mentor/MovieMentorCreatorAuthenticationTransport.js';
const transport=async({path,token,body})=>{const r=await fetch('/native-authority'+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error('native HTTP '+r.status);return r.json()};
const factory=createApplicationStudioSessionFactory({transport,resolveSelectionVaultId:async({token})=>{const proof=await transport({path:'/studio/selection-vault',token,body:{}});return proof?.ok===true?proof.vaultId:null},readLocalBytes:()=>JSON.stringify(localStorage.getItem('iband.creator-memory'))});
export function createRouteSession(auth){const session=factory(auth);globalThis.__nativeRouteSession=session;return session}
export function RouteWorkspace({nativeApplicationServices:app}){const nativeMovieService=useMemo(()=>({run:async(action,target)=>{const {token,selectionVaultId}=app.recoveryServices();if(action==='admit')return app.applicationSecondFilm.requestEditing({token,selectionVaultId,operationId:'browser-route-admit-'+crypto.randomUUID()});if(action==='submit')return app.submitNativeConversation(target);if(action==='create')return app.createNativeFilm({projectId:target,operationId:'browser-route-create-'+target});const current=await app.studioServices.request('/studio/selection-read',{projectId:selectionVaultId});const id=action==='resume'?current.activeProjectId:target;return current.activeProjectId===id?app.resumeNativeConversation({projectId:id}):app.applicationSecondFilm.choose({token,selectionVaultId,nextProjectId:id,selectionOperationId:'browser-route-switch-'+crypto.randomUUID(),localMemory:{getState:()=>({})}})}}),[app]);return <CreatorWorkspace nativeMovieService={nativeMovieService}/>;}
globalThis.__nativeSignIn=()=>setMovieMentorCreatorAuthState({isLoaded:true,isSignedIn:true,getToken:async()=>globalThis.__nativeToken});globalThis.__nativeSignOut=()=>clearMovieMentorCreatorAuthState();history.replaceState({},'', '/studio');createRoot(document.getElementById('root')).render(<BrowserRouter><App/></BrowserRouter>);`);
   // Vite proxy config is set before restarting the disposable browser server.
   vite.kill();await new Promise(resolve=>{if(vite.exitCode!==null||vite.signalCode!==null)resolve();else vite.once('exit',resolve)});
   writeFileSync(config,`import {defineConfig} from 'vite';import react from '@vitejs/plugin-react-swc';export default defineConfig({plugins:[react()],server:{proxy:{'/native-authority':{target:'http://127.0.0.1:${server.address().port}',changeOrigin:true,rewrite:path=>path.replace(/^\\/native-authority/,'')}}}});`);
   vite=spawn('./node_modules/.bin/vite',['--host','127.0.0.1','--port','52769','--strictPort','--config',base+'.config.mjs'],{cwd:root,stdio:['ignore','pipe','pipe']});
   let routeReady=false;for(let i=0;i<100;i++){try{if((await fetch(url)).ok){routeReady=true;break}}catch{}await new Promise(r=>setTimeout(r,150))}assert.ok(routeReady);
   const routePage=await browser.newPage(),requests=[];
   routePage.on('request',r=>{if(r.url().includes('/native-authority/'))requests.push(r.url())});
   await routePage.goto(url);
   await routePage.getByRole('status',{name:'Studio authority locked'}).waitFor({timeout:15000});
   assert.equal(await routePage.getByLabel('Verified native movie').count(),0);
   await routePage.evaluate(token=>{globalThis.__nativeToken=token;globalThis.__nativeSignIn()},foreign);
   await routePage.locator('[data-denial-reason="studio-auth-unverified"]').waitFor({state:'attached',timeout:15000});
   await routePage.evaluate(token=>{globalThis.__nativeToken=token;globalThis.__nativeSignIn()},owner);
   const routeIdentity=routePage.getByLabel('Verified native movie'),routeDisplay=routePage.getByLabel('Restored conversation');
   await routeIdentity.waitFor({timeout:15000});
   await routePage.getByText('After explicit cancellation',{exact:false}).waitFor({timeout:15000});
   assert.equal(await routeIdentity.textContent(),created);
   const bytes=await routePage.evaluate(()=>localStorage.getItem('iband.creator-memory'));
   await routePage.getByRole('button',{name:'Create new movie'}).click();
   await routePage.waitForFunction(previous=>{const x=document.querySelector('[aria-label="Verified native movie"]')?.textContent;return x?.startsWith('movie-project-')&&x!==previous},created);
   const routeFilm=await routeIdentity.textContent();assert.equal(await registry.countDocuments({projectId:routeFilm}),1);
   await routePage.getByRole('button',{name:'Request native writing'}).click();
   await routePage.getByText('Server writer admitted',{exact:true}).waitFor();
   await routePage.getByLabel('Native creator message').fill('Browser owned Studio route conversation');
   await routePage.getByRole('button',{name:'Settle native conversation'}).click();
   await routeDisplay.getByText('creator: Browser owned Studio route conversation',{exact:true}).waitFor({timeout:15000});
   assert.equal(await receipts.countDocuments({projectId:routeFilm}),1);
   assert.equal((await projects.findOne({_id:routeFilm})).state.conversationMessages.length,2);
   // The diagnostic HTML is the entry document; history.replaceState sets
   // /studio for BrowserRouter. A raw reload of /studio serves Vite's default
   // index.html instead of this disposable entry. Revisit the same entry
   // document to create a fresh JS realm and mount the identical /studio route.
   const routeReloadErrors=[];routePage.on('pageerror',e=>routeReloadErrors.push(String(e)));
   await routePage.goto(url,{waitUntil:'domcontentloaded'});
   try{await routePage.getByRole('status',{name:'Studio authority locked'}).waitFor({timeout:15000})}
   catch(e){throw Error('native route remount failed: '+routePage.url()+' errors='+JSON.stringify(routeReloadErrors)+' body='+await routePage.locator('body').innerText(),{cause:e})}
   assert.equal(new URL(routePage.url()).pathname,'/studio');
   assert.equal(await routePage.getByLabel('Verified native movie').count(),0);
   await routePage.evaluate(token=>{globalThis.__nativeToken=token;globalThis.__nativeSignIn()},owner);
   await routePage.getByLabel('Restored conversation').getByText('creator: Browser owned Studio route conversation',{exact:true}).waitFor({timeout:15000});
   assert.equal(await routePage.getByLabel('Verified native movie').textContent(),routeFilm);
   assert.equal(await routePage.evaluate(()=>localStorage.getItem('iband.creator-memory')),bytes);
   for(const path of ['/studio/selection-vault','/api/movie-mentor/projects','/studio/native-conversation-settle','/studio/native-conversation-recover'])assert.ok(requests.some(x=>x.endsWith(path)),path);
   await routePage.evaluate(()=>{globalThis.__retainedNativeServices=globalThis.__nativeRouteSession.getServices();globalThis.__nativeSignOut()});
   await routePage.getByRole('status',{name:'Studio authority locked'}).waitFor();
   assert.equal(await routePage.getByLabel('Verified native movie').count(),0);
   assert.equal(await routePage.evaluate(()=>globalThis.__nativeRouteSession.getServices()),null);
   assert.equal(await routePage.evaluate(async()=> (await globalThis.__retainedNativeServices.resumeNativeConversation({projectId:'denied'})).ok),false);
   assert.equal(await receipts.countDocuments({projectId:routeFilm}),1);
   console.log('GREEN PHYSICAL_BROWSER_OWNED_NATIVE_STUDIO_ROUTE_CREATION_SETTLEMENT_RECOVERY_AUTH_DENIAL');
   await routePage.close();
   // Mount the pinned conversation core through the same native route.
   // Native mode is an explicit alternative to the legacy transport and
   // pending-storage wrapper, never a second writer.
   const corePath=root+'src/components/studio/mentor/'+base+'_Core.jsx';
   files.push(corePath);
   let core=readFileSync(root+'src/components/studio/mentor/MovieMentorConversationCore.jsx','utf8');
   function coreExact(from,to){assert.equal(core.split(from).length,2,'pinned core drift: '+from);core=core.replace(from,to)}
   coreExact('  onDemonstrate, onTeach, onContinue, onThinkingChange, renderComposerExtra, renderAboveConversation, renderBelowConversation,','  onDemonstrate, onTeach, onContinue, onThinkingChange, renderComposerExtra, renderAboveConversation, renderBelowConversation, nativeSubmit, nativeReadOnly = false,');
   coreExact('  const [draft, setDraft] = useState("");','  const [draft, setDraft] = useState("");\n  const nativeInFlight=useRef(false);\n  const [nativeFailure,setNativeFailure]=useState(false);');
   coreExact('if (!text || effectiveThinking || isGenerating) return; const creatorMessage',`if (!text || effectiveThinking || isGenerating || nativeReadOnly || nativeInFlight.current) return;
    if(typeof nativeSubmit==="function"){
      nativeInFlight.current=true;setLocalIsThinking(true);setNativeFailure(false);
      try{const result=await nativeSubmit(text);if(result?.ok!==true)throw Error("Native settlement not verified");setDraft("");}
      catch{setNativeFailure(true);}
      finally{nativeInFlight.current=false;setLocalIsThinking(false);}
      return;
    }
    const creatorMessage`);
   coreExact('disabled={effectiveThinking || isGenerating} style={styles.textarea}','disabled={nativeReadOnly || effectiveThinking || isGenerating} style={styles.textarea}');
   coreExact('disabled={!draft.trim() || effectiveThinking || isGenerating} style={styles.sendButton}','disabled={nativeReadOnly || !draft.trim() || effectiveThinking || isGenerating} style={styles.sendButton}');
   coreExact('{renderComposerExtra?.()}{renderBelowConversation?.()}','{nativeFailure&&<p role="alert">Conversation not confirmed. Recover the saved film before retrying.</p>}{renderComposerExtra?.()}{renderBelowConversation?.()}');
   coreExact('<div style={styles.viewport}>','<div style={styles.viewport} aria-label="Committed conversation transcript">');
   writeFileSync(corePath,core);
   // Preserve the restricted candidate; add a cockpit mode to a separate copy.
   const cockpitPath=root+'src/components/studio/'+base+'_Cockpit.jsx';
   files.push(cockpitPath);
   let cockpit=readFileSync(component,'utf8');
   function cockpitExact(from,to){assert.equal(cockpit.split(from).length,2,'native cockpit drift: '+from);cockpit=cockpit.replace(from,to)}
   cockpitExact('import MovieMentorConversation from "./mentor/MovieMentorConversation.jsx";','import MovieMentorConversation from "./mentor/MovieMentorConversation.jsx";\nimport NativeConversationCore from "./mentor/'+base+'_Core.jsx";');
   cockpitExact('const [nativeWritable,setNativeWritable]=useState(false);','const [nativeWritable,setNativeWritable]=useState(false);\n  const nativeSubmission=useRef(false);');
   const start=cockpit.indexOf('      <input aria-label="Native creator message"');
   const end=cockpit.indexOf('      {nativeError&&',start);
   assert.ok(start>=0&&end>start);
   cockpit=cockpit.slice(0,start)+`      <div aria-label="Native cockpit conversation"><NativeConversationCore key={nativeProject||"locked"} projectId={nativeProject} messages={movieMessages} showJourney={false} showStartPointChooser={false} allowAttachments={false} allowVoice={false} nativeReadOnly={!nativeWritable||nativeBusy} nativeSubmit={async(text)=>{
        if(nativeSubmission.current||!nativeWritable||nativeBusy||!nativeProject)return {ok:false};
        const epoch=nativeEpoch.current,projectId=nativeProject;
        nativeSubmission.current=true;setNativeError("");setNativeWritable(false);
        try{
          const id=globalThis.crypto.randomUUID();
          const result=await nativeMovieService.run("submit",{creatorMessage:{id,role:"creator",text},mentorMessage:{id:globalThis.crypto.randomUUID(),role:"mentor",text:"Diagnostic mentor response",metadata:{backendMetadata:{creatorTurnId:id}}}});
          if(epoch!==nativeEpoch.current||!result?.ok||result.view?.projectId!==projectId||result.view?.mode!=="read-only"||!Array.isArray(result.view.conversationMessages))return {ok:false};
          setMovieMessages(result.view.conversationMessages);
          return {ok:true};
        }catch{return {ok:false};}
        finally{nativeSubmission.current=false;}
      }}/></div>
`+cockpit.slice(end);
   // Do not expose duplicate history rendering in the cockpit court.
   cockpitExact('      <ol aria-label="Restored conversation">{movieMessages.map((m,i)=><li key={m.id||i}>{m.role}: {m.text}</li>)}</ol>','');
   writeFileSync(cockpitPath,cockpit);
   let cockpitEntry=readFileSync(entry,'utf8');
   const importOld="import CreatorWorkspace from './src/components/studio/"+base+".jsx';";
   assert.equal(cockpitEntry.split(importOld).length,2);
   cockpitEntry=cockpitEntry.replace(importOld,"import CreatorWorkspace from './src/components/studio/"+base+"_Cockpit.jsx';");
   writeFileSync(entry,cockpitEntry);
   const cockpitPage=await browser.newPage();
   await cockpitPage.goto(url);
   await cockpitPage.getByRole('status',{name:'Studio authority locked'}).waitFor();
   await cockpitPage.evaluate(token=>{globalThis.__nativeToken=token;globalThis.__nativeSignIn()},owner);
   const cockpitRegion=cockpitPage.getByLabel('Native cockpit conversation');
   await cockpitRegion.getByText('Browser owned Studio route conversation',{exact:true}).waitFor({timeout:15000});
   const transcript=cockpitRegion.getByLabel('Committed conversation transcript');
   const composer=cockpitRegion.getByPlaceholder("Tell Movie Mentor what's on your mind...");
   assert.equal(await composer.isDisabled(),true);
   const cockpitBytes=await cockpitPage.evaluate(()=>JSON.stringify(Object.entries(localStorage).sort()));
   await cockpitPage.getByRole('button',{name:'Request native writing'}).click();
   await cockpitPage.getByText('Server writer admitted',{exact:true}).waitFor();
   await composer.fill('Genuine pinned composer native settlement');
   // Delay the physical settlement request and prove the UI has not published
   // an uncommitted creator message while the request is held.
   let release,heldResolve;const held=new Promise(r=>{heldResolve=r}),releaseGate=new Promise(r=>{release=r});
   await cockpitPage.route('**/native-authority/studio/native-conversation-settle',async route=>{heldResolve();await releaseGate;await route.continue()});
   await cockpitRegion.getByRole('button',{name:'Send',exact:true}).click();
   try{
     await Promise.race([held,new Promise((_,reject)=>setTimeout(()=>reject(Error('native composer did not send settlement')),10000))]);
     // The draft itself is intentionally retained in the disabled textarea.
     // Assert against the actual rendered conversation viewport, not the
     // entire region (Playwright can match textarea text content).
     assert.equal(await composer.inputValue(),'Genuine pinned composer native settlement');
     assert.equal(await transcript.getByText('Genuine pinned composer native settlement',{exact:true}).count(),0);
     assert.equal((await projects.findOne({_id:routeFilm})).state.conversationMessages.length,2);
     assert.equal(await receipts.countDocuments({projectId:routeFilm}),1);
     assert.equal(await composer.isDisabled(),true);
   }finally{release();}
   await transcript.getByText('Genuine pinned composer native settlement',{exact:true}).waitFor({timeout:15000});
   assert.equal(await receipts.countDocuments({projectId:routeFilm}),2);
   assert.equal((await projects.findOne({_id:routeFilm})).state.conversationMessages.length,4);
   assert.equal(await composer.isDisabled(),true);
   await cockpitPage.waitForFunction(()=>document.querySelector('[aria-label="Native cockpit conversation"] textarea')?.value==='');
   assert.equal(await transcript.getByText('Genuine pinned composer native settlement',{exact:true}).count(),1);
   assert.equal(await cockpitPage.evaluate(()=>JSON.stringify(Object.entries(localStorage).sort())),cockpitBytes);
   await cockpitPage.goto(url,{waitUntil:'domcontentloaded'});
   await cockpitPage.getByRole('status',{name:'Studio authority locked'}).waitFor();
   await cockpitPage.evaluate(token=>{globalThis.__nativeToken=token;globalThis.__nativeSignIn()},owner);
   await transcript.getByText('Genuine pinned composer native settlement',{exact:true}).waitFor({timeout:15000});
   assert.equal(await transcript.getByText('Genuine pinned composer native settlement',{exact:true}).count(),1);
   assert.equal(await receipts.countDocuments({projectId:routeFilm}),2);
   await cockpitPage.evaluate(()=>globalThis.__nativeSignOut());
   await cockpitPage.getByRole('status',{name:'Studio authority locked'}).waitFor();
   assert.equal(await cockpitRegion.count(),0);
   await cockpitPage.close();
   console.log('GREEN PHYSICAL_PINNED_NATIVE_CONVERSATION_CORE_COMPOSER_ATOMIC_PUBLICATION_AND_RECOVERY');
   // New strict court: invoke the genuine pinned HTTP gateway with a local
   // provider, then independently reread canonical execution and accounting.
   // Existing fixture-based courts above remain unchanged.
   process.env.IBAND_AI_PROVIDER='openai';
   process.env.IBAND_AI_MODEL='gpt-isolated';
   process.env.IBAND_AI_API_KEY='isolated-only';
 const providerRequests=[];
 const providerServer=http.createServer(async(req,res)=>{
  let body="";for await(const chunk of req)body+=chunk;
  providerRequests.push({path:req.url,method:req.method,idempotencyKey:req.headers["idempotency-key"]||null});
  let requestBody;
  try{requestBody=JSON.parse(body);}catch{
   res.writeHead(400,{"content-type":"application/json"});
   res.end(JSON.stringify({error:{message:"Invalid isolated provider JSON"}}));
   return;
  }
  const schema=requestBody?.text?.format?.schema;
  console.log("PHYSICAL POSITIVE PROVIDER SCHEMA: "+JSON.stringify({
   schemaName:requestBody?.text?.format?.name||null,
   topLevelRequired:Array.isArray(schema?.required)?schema.required:[],
   topLevelProperties:Object.keys(schema?.properties||{}),
   propertyContracts:Object.fromEntries(Object.entries(schema?.properties||{}).map(([key,value])=>[key,{type:value?.type||null,required:value?.required||[],properties:Object.keys(value?.properties||{}),itemsType:value?.items?.type||null,itemRequired:value?.items?.required||[],itemProperties:Object.fromEntries(Object.entries(value?.items?.properties||{}).map(([k,v])=>[k,{type:v?.type||null,enum:v?.enum||null}])),nextActionRequired:value?.properties?.required||[],nextActionProperties:Object.fromEntries(Object.entries(value?.properties||{}).map(([k,v])=>[k,{type:v?.type||null,enum:v?.enum||null}])),enum:value?.enum||null}])),
   model:requestBody?.model||null
  }));
  if(requestBody?.text?.format?.name==="movie_journey_intelligence"){
   const semantic={
    understoodContext:[{key:"creator.intent",value:"isolated positive creator turn",evidence:"isolated positive creator turn",confidenceSource:"creator-explicit"}],
    provisionalContext:[],unresolvedContext:[],clarificationNeeded:[],readyToAdvance:true,
    recommendedStageId:null,recommendedTaskId:null,nextAction:null,resumeNote:null
   };
   res.writeHead(200,{"content-type":"application/json"});
   res.end(JSON.stringify({id:"isolated-semantic-response-1",model:"gpt-isolated",output:[{type:"message",content:[{type:"output_text",text:JSON.stringify(semantic)}]}]}));
   return;
  }
  const schemaName=requestBody?.text?.format?.name||"";
  if(["movie_mentor_story_contribution","movie_mentor_character_contribution","movie_mentor_continuity_contribution"].includes(schemaName)){
   const requiredAgent=schema?.properties?.agentId?.enum?.[0];
   const fixture={
    agentId:requiredAgent,
    confidence:0.9,
    provenance:{source:"isolated-local-provider",model:"gpt-isolated",contractVersion:"1"},
   };
   for(const field of schema?.required||[]){
    if(field in fixture)continue;
    const property=schema?.properties?.[field];
    if(property?.type==="array")fixture[field]=[];
    else if(property?.type==="boolean")fixture[field]=false;
    else if(property?.type==="number")fixture[field]=0.9;
    else if(property?.type==="string")fixture[field]=property?.enum?.[0]||"isolated";
    else if(property?.type==="object")fixture[field]={};
    else fixture[field]=null;
   }
   const responseId="isolated-"+schemaName+"-"+providerRequests.length;
   res.writeHead(200,{"content-type":"application/json"});
   res.end(JSON.stringify({id:responseId,model:"gpt-isolated",output:[{type:"message",content:[{type:"output_text",text:JSON.stringify(fixture)}]}]}));
   return;
  }
  if(schemaName==="movie_mentor_synthesis"){
   const synthesis={
    text:"I understand your isolated creator request. What would you like to develop next?",
    usedContributionAgentIds:["story","character","continuity"],
    deferredContributionAgentIds:[],
    continuationObedienceClaims:[],
    conflictsHandled:[],
    confidence:0.9,
    provenance:{source:"isolated-local-provider",model:"gpt-isolated",contractVersion:"1"}
   };
   res.writeHead(200,{"content-type":"application/json"});
   res.end(JSON.stringify({id:"isolated-synthesis-response-1",model:"gpt-isolated",output:[{type:"message",content:[{type:"output_text",text:JSON.stringify(synthesis)}]}]}));
   return;
  }
  res.writeHead(503,{"content-type":"application/json"});
  res.end(JSON.stringify({error:{message:"Unimplemented isolated provider stage: "+String(requestBody?.text?.format?.name||"unknown"),type:"isolated_fixture_pending"}}));
 });

   await new Promise(resolve=>providerServer.listen(0,'127.0.0.1',resolve));
   process.env.IBAND_AI_BASE_URL='http://127.0.0.1:'+providerServer.address().port+'/v1/responses';
   let executionServer;
   try{
    // Provision the pinned backend's physical authority contracts in the disposable Mongo database.
    const authorityDb=mongoose.connection.db;
    assert.match(uri,/^mongodb:\/\/127\.0\.0\.1:27017\//);
    for(const requirement of [...EXECUTION_REQUIRED,...SETTLEMENT_REQUIRED])await authorityDb.collection(requirement.collection).createIndex(requirement.key,{unique:true});
    await authorityDb.collection('movie_mentor_provider_operation_reality').createIndex({providerCallId:1},{unique:true});
    await authorityDb.collection('movie_mentor_result_candidate').createIndex({candidateReference:1},{unique:true});
    for(const key of [{resultReference:1},{candidateReference:1},{executionId:1},{principalId:1,projectId:1,creatorTurnId:1},{reservationId:1}])await authorityDb.collection('movie_mentor_canonical_result').createIndex(key,{unique:true});
    await authorityDb.collection('movie_mentor_creator_state').createIndex({projectId:1},{unique:true,partialFilterExpression:{projectId:{$type:'string'}}});
    const spend=createMovieMentorProductionInferenceSpendComposition(),execution=createMovieMentorProductionInferenceExecutionComposition();
    assert.equal(spend.ready,true);assert.equal(execution.ready,true);
    const accounting=createMovieMentorInferenceSettlementReconciliationAuthority({store:createMovieMentorInferenceSettlementMongoStore()});
    const requestAuthority=createMovieMentorCreatorRequestAuthority({expectedIssuer:issuer,expectedAudience:audience,ownershipAuthority,verifyCredential:async({credential})=>{
     const subject=authenticate(credential);if(!subject)throw Error('invalid token');
     return {verified:true,subject,issuer,audience,verificationMethod:'RS256-test',verificationVersion:'1',authenticatedAt:new Date(now*1000),expiresAt:new Date((now+600)*1000),active:true,revoked:false};
    }});
    const executionApp=express();executionApp.use(express.json());
    executionApp.use('/api/movie-mentor',createMovieMentorTurnRouter({requestAuthority,inferenceSpendAuthority:spend.authority,inferenceExecutionAuthority:execution.authority,inferenceSettlementAuthority:accounting}));
    const canonicalize=x=>x===null||typeof x!=='object'?x:Array.isArray(x)?x.map(canonicalize):Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonicalize(x[k])]));
    const hash=x=>createHash('sha256').update(JSON.stringify(canonicalize(x))).digest('hex');
    const strict=createPhysicalProvenanceFencedSceneSettlement({client,gate,projects,receipts,verifyMentorExecution:async({ownerId,projectId,creatorTurnId,creatorMessage,mentorMessage})=>{
     const requestDigest=buildRequestDigest({creatorMessage:creatorMessage.text.trim(),projectId,options:{}});
     const row=await mongoose.connection.db.collection('movie_mentor_inference_execution').findOne({principalId:ownerId,projectId,creatorTurnId,requestDigest,phase:'settled'});
     if(!row?.executionId)return false;
     const c=await execution.authority.readCanonicalResult({executionId:row.executionId});
     if(c?.authorized!==true||c.committed!==true||c.currentRealityVerified!==true||c.candidateLineageVerified!==true||c.resultFinalizationVerified!==true||c.executionPhase!=='settled'||c.principalId!==ownerId||c.projectId!==projectId||c.creatorTurnId!==creatorTurnId||c.requestDigest!==requestDigest||!c.resultPayload||hash(c.resultPayload)!==c.resultDigest||c.resultPayload.text!==mentorMessage.text)return false;
     const a=await accounting.reconcile({executionId:row.executionId});
     return a?.authorized===true&&a.settled===true&&a.outcome==='consumed'&&a.resultFinalizationVerified===true&&a.executionPhase==='settled'&&['executionId','principalId','projectId','reservationId','resultReference','candidateReference','resultDigest','closureCertificateDigest','providerEffectRealityRevision'].every(k=>a[k]!==undefined&&a[k]===c[k]);
    }});
    executionApp.post('/studio/strict-conversation-settle',async(req,res)=>res.json(await strict.settleConversation({...req.body,token:req.get('authorization')?.replace(/^Bearer /,'')})));
    executionServer=executionApp.listen(0,'127.0.0.1');await new Promise((resolve,reject)=>{executionServer.once('listening',resolve);executionServer.once('error',reject)});
    const call=async(path,body,token=owner)=>{const response=await fetch('http://127.0.0.1:'+executionServer.address().port+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json()}};
    const fresh=factory({getAuthToken:async()=>owner}),freshOpened=await fresh.open();assert.equal(freshOpened.ok,true);
    const service=freshOpened.services;
    assert.equal((await service.resumeNativeConversation({projectId:routeFilm})).ok,true);
    const admitted=await service.applicationSecondFilm.requestEditing({token:owner,selectionVaultId:vaultId,operationId:'strict-execution-'+randomUUID()});
    assert.equal(admitted.ok,true,JSON.stringify(admitted));
    const canonical=await provenance.states.findOne({projectId:routeFilm,ownerId,revoked:false});
    const admission=await gate.admissions.findOne({projectId:routeFilm,ownerId,fence:canonical.activeWriterFence,status:'admitted'});
    assert.ok(admission);
    const creatorTurnId=randomUUID(),message='isolated positive creator turn';
    const input={projectId:routeFilm,creatorTurnId,message,options:{}};
    const entitlements=mongoose.connection.db.collection('movie_mentor_inference_entitlement');
    await entitlements.insertOne({domain:'iband.movie-mentor.inference-spend',schema:1,principalId:ownerId,status:'active',remainingUnits:1,reservedUnits:0,consumedUnits:0,entitlementRevision:1});
    const creatorState=mongoose.connection.db.collection('movie_mentor_creator_state');
    await creatorState.createIndex({projectId:1},{unique:true,partialFilterExpression:{projectId:{$type:'string'}}});
    await creatorState.insertOne({projectId:routeFilm,revision:0,revisionAuthorityReference:'strict-'+creatorTurnId,creatorStateGeneration:1,creatorStateFingerprint:'strict-fingerprint-'+creatorTurnId,creatorAuthorityReference:'strict-authority-'+creatorTurnId,snapshotReference:'strict-snapshot-'+creatorTurnId,capturedAt:new Date()});
    const pair={selectionVaultId:vaultId,projectId:routeFilm,operationId:admission.operationId+':'+creatorTurnId,creatorTurnId,expectedRevision:canonical.revision,fence:admission.fence,creatorMessage:{id:creatorTurnId,role:'creator',text:message},mentorMessage:{id:randomUUID(),role:'mentor',text:'forged-before-execution',metadata:{backendMetadata:{creatorTurnId}}}};
    const before=await projects.findOne({_id:routeFilm});
    const submit=async(body,token=owner)=>(await call('/studio/strict-conversation-settle',body,token)).body;
    assert.equal((await submit(pair)).ok,false);
    assert.deepEqual(await projects.findOne({_id:routeFilm}),before);
    assert.notEqual((await call('/api/movie-mentor/turn',input,foreign)).status,200);
    const response=await call('/api/movie-mentor/turn',input);
    assert.equal(response.status,200,JSON.stringify(response.body));assert.equal(response.body.success,true);assert.equal(response.body.status,'mentor-response-ready');
    assert.equal(providerRequests.length,5);
    assert.equal((await submit(pair)).ok,false);
    const genuine={...pair,mentorMessage:{...pair.mentorMessage,text:response.body.text}};
    assert.equal((await submit({...genuine,creatorMessage:{...genuine.creatorMessage,text:'altered request'}})).ok,false);
    assert.equal((await submit({...genuine,fence:'stale-fence'})).ok,false);
    assert.equal((await submit(genuine,foreign)).ok,false);
    assert.deepEqual(await projects.findOne({_id:routeFilm}),before);
    const replay=await call('/api/movie-mentor/turn',input);
    assert.equal(replay.status,200,JSON.stringify(replay.body));assert.equal(replay.body.text,response.body.text);assert.equal(providerRequests.length,5);
    const committed=await submit(genuine);assert.equal(committed.ok,true,JSON.stringify(committed));
    const duplicate=await submit(genuine);assert.equal(duplicate.ok,true);assert.equal(duplicate.replay,true);assert.equal(duplicate.serverCommitId,committed.serverCommitId);
    assert.equal(await receipts.countDocuments({projectId:routeFilm}),3);
    assert.deepEqual((await projects.findOne({_id:routeFilm})).state.conversationMessages.slice(-2),[genuine.creatorMessage,genuine.mentorMessage]);
    assert.equal((await entitlements.findOne({principalId:ownerId})).consumedUnits,1);
    fresh.invalidate();
    const recovered=factory({getAuthToken:async()=>owner}),reopened=await recovered.open();assert.equal(reopened.ok,true);
    const restored=await reopened.services.resumeNativeConversation({projectId:routeFilm});assert.equal(restored.ok,true,JSON.stringify(restored));
    assert.deepEqual(restored.view.conversationMessages.slice(-2),[genuine.creatorMessage,genuine.mentorMessage]);
    assert.equal((await submit(genuine)).ok,false);assert.equal(await receipts.countDocuments({projectId:routeFilm}),3);
    recovered.invalidate();
    console.log('GREEN PHYSICAL_CANONICAL_MENTOR_EXECUTION_NATIVE_SETTLEMENT_FORGERY_REPLAY_AND_RECOVERY');
    // Independent browser adoption court. Keep the fixture and strict HTTP courts above.
    // The legacy composer path must fail here, before it can publish a fabricated response.
    const policy=await gate.states.updateOne({projectId:routeFilm,ownerId,revoked:false,activeWriterFence:{$exists:false}},{$set:{strictCanonicalConversation:true}});
    assert.equal(policy.modifiedCount,1,'strict policy must be durable before any strict writer admission');
    const strictBindings=db.collection('native_execution_initiation_bindings');
    await strictBindings.createIndex({ownerId:1,projectId:1,creatorTurnId:1},{unique:true});
    await strictBindings.createIndex({ownerId:1,projectId:1,fence:1},{unique:true});
    app.post('/studio/native-execution-initiate',async(req,res)=>{
     const token=req.get('authorization')?.replace(/^Bearer /,''),subject=authenticate(token);
     const {projectId,selectionVaultId,operationId,creatorTurnId,expectedRevision,fence,creatorMessage,requestDigest}=req.body||{};
     const deny=()=>res.json({ok:false});
     if(!subject||typeof projectId!=='string'||typeof selectionVaultId!=='string'||typeof operationId!=='string'||typeof fence!=='string'||!Number.isSafeInteger(expectedRevision)||typeof creatorTurnId!=='string'||creatorMessage?.id!==creatorTurnId||creatorMessage.role!=='creator'||typeof creatorMessage.text!=='string'||!creatorMessage.text.trim()||creatorMessage.text!==creatorMessage.text.trim()||Object.hasOwn(req.body,'mentorMessage'))return deny();
     const digest=buildRequestDigest({creatorMessage:creatorMessage.text,projectId,options:{}});
     if(requestDigest!==digest)return deny();
     const ownership=await ownershipAuthority.authorizeProject({principal:{authenticated:true,principalId:subject},projectId});
     if(ownership?.authorized!==true)return deny();
     const session=client.startSession();
     let bound;
     try{bound=await session.withTransaction(async()=>{
      const vault=await gate.states.findOne({projectId:selectionVaultId,ownerId:subject,revoked:false,'state.content.activeProjectId':projectId},{session});
      const writer=await gate.admissions.findOne({projectId,ownerId:subject,fence,status:'admitted',revision:expectedRevision},{session});
      if(!vault||!writer||operationId!==writer.operationId+':'+creatorTurnId)return false;
      const state=await gate.states.findOne({projectId,ownerId:subject,revoked:false,revision:expectedRevision,ownershipRevision:writer.ownershipRevision,activeWriterFence:fence,activeAdoptionGrant:writer.grantId},{session});
      if(!state||state.strictCanonicalConversation!==true)return false;
      const identity={ownerId:subject,projectId,creatorTurnId};
      const binding={...identity,selectionVaultId,operationId,expectedRevision,fence,requestDigest:digest};
      const prior=await strictBindings.findOne(identity,{session});
      if(prior&&Object.entries(binding).some(([k,val])=>prior[k]!==val))return false;
      const lock=await gate.states.updateOne({_id:vault._id,revision:vault.revision,revoked:false,'state.content.activeProjectId':projectId},{$inc:{nativeExecutionInitiationFence:1}},{session});
      const writerLock=await gate.states.updateOne({_id:state._id,revision:expectedRevision,activeWriterFence:fence,revoked:false},{$inc:{nativeExecutionInitiationFence:1}},{session});
      if(lock.modifiedCount!==1||writerLock.modifiedCount!==1)throw Error('native-initiation-race');
      if(!prior)await strictBindings.insertOne(binding,{session});
      return true;
     },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'}})}catch{return deny()}finally{await session.endSession()}
     if(!bound)return deny();
     const response=await call('/api/movie-mentor/turn',{projectId,creatorTurnId,message:creatorMessage.text,options:{}},token);
     if(response.status!==200||response.body?.success!==true||response.body.status!=='mentor-response-ready'||typeof response.body.text!=='string')return deny();
     const mentorMessage={id:'mentor-'+creatorTurnId,role:'mentor',text:response.body.text,metadata:{backendMetadata:{creatorTurnId}}};
     return res.json({ok:true,projectId,creatorTurnId,requestDigest:digest,mentorMessage});
    });
    app.post('/studio/strict-conversation-settle',async(req,res)=>{
     const token=req.get('authorization')?.replace(/^Bearer /,''),subject=authenticate(token),body=req.body||{};
     if(!subject)return res.json({ok:false});
     const binding=await strictBindings.findOne({ownerId:subject,projectId:body.projectId,creatorTurnId:body.creatorTurnId,operationId:body.operationId,fence:body.fence,expectedRevision:body.expectedRevision,selectionVaultId:body.selectionVaultId});
     if(!binding||binding.requestDigest!==buildRequestDigest({creatorMessage:body.creatorMessage?.text?.trim()||'',projectId:body.projectId,options:{}}))return res.json({ok:false});
     return res.json(await strict.settleConversation({...body,token}));
    });
    const strictCockpitPath=root+'src/components/studio/'+base+'_StrictCockpit.jsx';
    files.push(strictCockpitPath);
    const fixtureSubmit='const result=await nativeMovieService.run("submit",{creatorMessage:{id,role:"creator",text},mentorMessage:{id:globalThis.crypto.randomUUID(),role:"mentor",text:"Diagnostic mentor response",metadata:{backendMetadata:{creatorTurnId:id}}}});';
    assert.equal(cockpit.split(fixtureSubmit).length,2);
    writeFileSync(strictCockpitPath,cockpit.replace(fixtureSubmit,'const result=await nativeMovieService.run("submitCanonical",{creatorMessage:{id,role:"creator",text}});'));
    const strictEntry=cockpitEntry.replace(base+'_Cockpit.jsx',base+'_StrictCockpit.jsx').replace("if(action==='submit')return app.submitNativeConversation(target);","if(action==='submitCanonical')return app.submitNativeConversation(target,{canonical:true});if(action==='submit')return app.submitNativeConversation(target);");
    assert.notEqual(strictEntry,cockpitEntry);
    writeFileSync(entry,strictEntry);
    const canonicalPage=await browser.newPage();
    try{
     await canonicalPage.goto(url);
     await canonicalPage.getByRole('status',{name:'Studio authority locked'}).waitFor();
     await canonicalPage.evaluate(token=>{globalThis.__nativeToken=token;globalThis.__nativeSignIn()},owner);
     const region=canonicalPage.getByLabel('Native cockpit conversation');
     const transcript=region.getByLabel('Committed conversation transcript');
     const composer=region.getByPlaceholder("Tell Movie Mentor what's on your mind...");
     await transcript.getByText(genuine.creatorMessage.text,{exact:true}).waitFor({timeout:15000});
     await canonicalPage.getByRole('button',{name:'Request native writing'}).click();
     await canonicalPage.getByText('Server writer admitted',{exact:true}).waitFor();
     const browserMessage='Canonical browser execution adoption '+randomUUID();
     const beforeBrowser=await projects.findOne({_id:routeFilm});
     const beforeBalance=await entitlements.findOne({principalId:ownerId});
     const beforeCalls=providerRequests.length;
     const beforeReceipts=await receipts.countDocuments({projectId:routeFilm});
     await entitlements.updateOne({principalId:ownerId},{$inc:{remainingUnits:1,entitlementRevision:1}});
     let observed,release,signal;
     const initiationAttempts=[],settlementAttempts=[];
     let lostExecutionAck=false,lostSettlementAck=false;
     const observedRequest=new Promise(resolve=>{signal=resolve});
     const released=new Promise(resolve=>{release=resolve});
     await canonicalPage.route('**/native-authority/**',async route=>{
      const request=route.request(),path=new URL(request.url()).pathname.replace('/native-authority','');
      if(!observed&&['/studio/native-execution-initiate','/studio/native-conversation-settle','/studio/strict-conversation-settle','/api/movie-mentor/turn'].includes(path)){
       observed={path,body:request.postDataJSON()};
       signal();await released;
       if(path!=='/studio/native-execution-initiate'){await route.abort();return;}
      }
      if(path==='/studio/native-execution-initiate'){
       initiationAttempts.push(request.postDataJSON());
       if(!lostExecutionAck){
        const result=await route.fetch();assert.equal(result.ok(),true);
        const body=await result.json();assert.equal(body.ok,true,JSON.stringify(body));
        assert.equal(providerRequests.length,beforeCalls+5);
        assert.deepEqual(await projects.findOne({_id:routeFilm}),beforeBrowser);
        lostExecutionAck=true;await route.abort('failed');return;
       }
      }
      if(path==='/studio/strict-conversation-settle'){
       settlementAttempts.push(request.postDataJSON());
       if(!lostSettlementAck){
        const result=await route.fetch();assert.equal(result.ok(),true);
        const body=await result.json();assert.equal(body.ok,true,JSON.stringify(body));
        assert.equal(await receipts.countDocuments({projectId:routeFilm}),beforeReceipts+1);
        lostSettlementAck=true;await route.abort('failed');return;
       }
      }
      await route.continue();
     });
     await composer.fill(browserMessage);
     await region.getByRole('button',{name:'Send',exact:true}).click();
     try{
      await Promise.race([observedRequest,new Promise((_,reject)=>setTimeout(()=>reject(Error('canonical browser composer did not initiate execution')),10000))]);
      assert.equal(observed.path,'/studio/native-execution-initiate','genuine browser composer must initiate fenced canonical execution, not fixture settlement');
      assert.equal(observed.body.projectId,routeFilm);
      assert.equal(observed.body.creatorMessage?.text,browserMessage);
      assert.equal(observed.body.creatorMessage?.id,observed.body.creatorTurnId);
      assert.ok(observed.body.fence);
      assert.equal(Object.hasOwn(observed.body,'mentorMessage'),false);
      assert.equal(await transcript.getByText(browserMessage,{exact:true}).count(),0);
      assert.deepEqual(await projects.findOne({_id:routeFilm}),beforeBrowser);
      assert.equal(providerRequests.length,beforeCalls);
      const direct=async(body,token=owner)=>{const r=await fetch('http://127.0.0.1:'+server.address().port+'/studio/native-execution-initiate',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});return r.json()};
      const original=observed.body;
      for(const [body,token] of [[{...original,fence:'stale-fence'},owner],[original,foreign],[{...original,creatorMessage:{...original.creatorMessage,text:'altered request'}},owner],[{...original,mentorMessage:{text:'forged'}},owner]]){
       assert.equal((await direct(body,token)).ok,false);
      }
      assert.equal(providerRequests.length,beforeCalls);
      assert.equal((await entitlements.findOne({principalId:ownerId})).consumedUnits,beforeBalance.consumedUnits);
      console.log('GREEN PHYSICAL_NATIVE_EXECUTION_INITIATION_PRE_DISPATCH_DENIAL');
     }finally{release();}
     await transcript.getByText(browserMessage,{exact:true}).waitFor({timeout:20000});
     assert.equal(lostExecutionAck,true);assert.equal(lostSettlementAck,true);
     assert.equal(initiationAttempts.length,2);
     assert.deepEqual(initiationAttempts[0],initiationAttempts[1]);
     assert.equal(settlementAttempts.length,1);
     assert.equal(settlementAttempts[0].creatorTurnId,observed.body.creatorTurnId);
     assert.equal(settlementAttempts[0].operationId,observed.body.operationId);
     console.log('GREEN PHYSICAL_BROWSER_EXECUTION_AND_SETTLEMENT_ACK_LOSS_SAME_TURN_RECOVERY');
     const browserExecution=await authorityDb.collection('movie_mentor_inference_execution').findOne({principalId:ownerId,projectId:routeFilm,creatorTurnId:observed.body.creatorTurnId,phase:'settled'});
     assert.ok(browserExecution);
     const browserResult=await execution.authority.readCanonicalResult({executionId:browserExecution.executionId});
     assert.equal(browserResult.authorized,true);
     assert.equal(browserResult.requestDigest,buildRequestDigest({creatorMessage:browserMessage,projectId:routeFilm,options:{}}));
     const published=await projects.findOne({_id:routeFilm});
     assert.equal(published.revision,beforeBrowser.revision+1);
     assert.equal(published.state.conversationMessages.at(-2).text,browserMessage);
     assert.equal(published.state.conversationMessages.at(-1).text,browserResult.resultPayload.text);
     assert.equal(providerRequests.length,beforeCalls+5);
     assert.equal(await receipts.countDocuments({projectId:routeFilm}),beforeReceipts+1);
     assert.equal((await entitlements.findOne({principalId:ownerId})).consumedUnits,beforeBalance.consumedUnits+1);
     await canonicalPage.goto(url,{waitUntil:'domcontentloaded'});
     await canonicalPage.getByRole('status',{name:'Studio authority locked'}).waitFor();
     await canonicalPage.evaluate(token=>{globalThis.__nativeToken=token;globalThis.__nativeSignIn()},owner);
     await transcript.getByText(browserMessage,{exact:true}).waitFor({timeout:15000});
     assert.equal(await transcript.getByText(browserMessage,{exact:true}).count(),1);
     assert.equal(providerRequests.length,beforeCalls+5);
     assert.equal((await entitlements.findOne({principalId:ownerId})).consumedUnits,beforeBalance.consumedUnits+1);
     console.log('GREEN PHYSICAL_GENUINE_BROWSER_CANONICAL_EXECUTION_SETTLEMENT_AND_RELOAD');
     // Separate physical strict-mode bypass court, after all prior positive controls.
     await canonicalPage.unroute('**/native-authority/**');
     await canonicalPage.getByRole('button',{name:'Request native writing'}).click();
     await canonicalPage.getByText('Server writer admitted',{exact:true}).waitFor();
     const strictState=await gate.states.findOne({projectId:routeFilm,ownerId,revoked:false});
     const strictWriter=await gate.admissions.findOne({projectId:routeFilm,ownerId,fence:strictState.activeWriterFence,status:'admitted'});
     assert.ok(strictWriter);
     const bypassTurn=randomUUID(),bypassText='Strict composer bypass attempt';
     const bypass={selectionVaultId:vaultId,projectId:routeFilm,operationId:strictWriter.operationId+':'+bypassTurn,creatorTurnId:bypassTurn,expectedRevision:strictState.revision,fence:strictWriter.fence,creatorMessage:{id:bypassTurn,role:'creator',text:bypassText},mentorMessage:{id:randomUUID(),role:'mentor',text:'forged legacy response',metadata:{backendMetadata:{creatorTurnId:bypassTurn}}}};
     const bypassBefore=await projects.findOne({_id:routeFilm}),bypassReceipts=await receipts.countDocuments({projectId:routeFilm}),bypassCalls=providerRequests.length,bypassBalance=await entitlements.findOne({principalId:ownerId});
     const bypassResult=await canonicalPage.evaluate(async({body,token})=>{const response=await fetch('/native-authority/studio/native-conversation-settle',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});return response.json()},{body:bypass,token:owner});
     assert.equal(bypassResult.ok,false,'strict writer must deny legacy settlement even before any canonical execution binding exists');
     assert.deepEqual(await projects.findOne({_id:routeFilm}),bypassBefore);
     assert.equal(await receipts.countDocuments({projectId:routeFilm}),bypassReceipts);
     assert.equal(providerRequests.length,bypassCalls);
     assert.deepEqual(await entitlements.findOne({principalId:ownerId}),bypassBalance);
     assert.equal(await transcript.getByText(bypassText,{exact:true}).count(),0);
     console.log('GREEN PHYSICAL_STRICT_BROWSER_LEGACY_SETTLEMENT_BYPASS_DENIAL');
     // A fully destroyed browser realm must recover a completed but unpublished turn.
     const interruptionMessage='Canonical execution completed before browser interruption '+randomUUID();
     await entitlements.updateOne({principalId:ownerId},{$inc:{remainingUnits:1,entitlementRevision:1}});
     let notifyInterrupted,interruptedIntent;
     const interrupted=new Promise(resolve=>{notifyInterrupted=resolve});
     await canonicalPage.route('**/native-authority/studio/native-execution-initiate',async route=>{
      interruptedIntent=route.request().postDataJSON();
      const response=await route.fetch();assert.equal(response.ok(),true);
      const body=await response.json();assert.equal(body.ok,true,JSON.stringify(body));
      notifyInterrupted();await new Promise(resolve=>canonicalPage.once('close',resolve));
     });
     await composer.fill(interruptionMessage);
     await region.getByRole('button',{name:'Send',exact:true}).click();
     await Promise.race([interrupted,new Promise((_,reject)=>setTimeout(()=>reject(Error('interruption court did not reach canonical execution completion')),15000))]);
     assert.deepEqual(await projects.findOne({_id:routeFilm}),bypassBefore);
     assert.equal(await receipts.countDocuments({projectId:routeFilm}),bypassReceipts);
     assert.equal(providerRequests.length,bypassCalls+5);
     assert.equal((await entitlements.findOne({principalId:ownerId})).consumedUnits,bypassBalance.consumedUnits+1);
     assert.equal(await transcript.getByText(interruptionMessage,{exact:true}).count(),0);
     await canonicalPage.close();
     const restarted=await browser.newPage();
     try{
      await restarted.goto(url);
      await restarted.getByRole('status',{name:'Studio authority locked'}).waitFor();
      await restarted.evaluate(token=>{globalThis.__nativeToken=token;globalThis.__nativeSignIn()},owner);
      const restoredTranscript=restarted.getByLabel('Committed conversation transcript');
      await restoredTranscript.getByText(interruptionMessage,{exact:true}).waitFor({timeout:15000});
      assert.equal(await restoredTranscript.getByText(interruptionMessage,{exact:true}).count(),1);
      const recoveredProject=await projects.findOne({_id:routeFilm});
      assert.equal(recoveredProject.revision,bypassBefore.revision+1);
      assert.equal(recoveredProject.state.conversationMessages.at(-2).id,interruptedIntent.creatorTurnId);
      assert.equal(await receipts.countDocuments({projectId:routeFilm}),bypassReceipts+1);
      assert.equal(providerRequests.length,bypassCalls+5);
      assert.equal((await entitlements.findOne({principalId:ownerId})).consumedUnits,bypassBalance.consumedUnits+1);
      console.log('GREEN PHYSICAL_COMPLETE_BROWSER_INTERRUPTION_CANONICAL_UNPUBLISHED_TURN_RECOVERY');
     }finally{await restarted.close();}

    }finally{await canonicalPage.close();}

   }finally{if(executionServer)await new Promise(r=>executionServer.close(r));await new Promise(r=>providerServer.close(r));}
   console.log('GREEN PHYSICAL_NATIVE_BROWSER_WRITER_SETTLEMENT_RECEIPT_AND_RENEWAL');
   console.log('GREEN PHYSICAL_PINNED_CREATORWORKSPACE_NATIVE_READONLY_CONVERSATION_RELOAD_AND_CREATION');
  }finally{if(browser)await browser.close();if(vite)vite.kill();for(const f of files)try{unlinkSync(f)}catch{}}
  session.invalidate();assert.equal(session.getServices(),null);
  assert.equal(views.at(-1),null);
  console.log('GREEN PHYSICAL_NATIVE_FRESH_SERVER_AUTHENTICATED_TWO_FILM_CONVERSATION_PROJECTION');
 }else{
 const identity={domain:'iband.movie-mentor.project',schema:1,issuance:'secure-web-crypto',legacy:false};
 const create=(projectId,token=owner)=>fetch('http://127.0.0.1:'+server.address().port+'/api/movie-mentor/projects',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({projectId,identity})});
 const {vaultId}=await vaults.create({token:owner});assert.ok(vaultId);
 const filmA='movie-project-'+randomUUID(),filmB='movie-project-'+randomUUID();
 assert.equal((await registration.register({token:owner,projectId:filmA})).ok,false);
 assert.equal((await create(filmA)).status,201);
 assert.equal((await registration.register({token:owner,projectId:filmA})).ok,true);
 const history=[{role:'creator',text:'Midnight door'},{role:'mentor',text:'Opening scene'}];
 assert.equal((await provenance.append({token:owner,projectId:filmA,operationId:'film-a-conversation',expectedRevision:1,content:{scenes:[],conversationMessages:history}})).ok,true);
 await projects.updateOne({_id:filmA},{$set:{revision:2,state:{scenes:[],conversationMessages:history}}});
 const before=await provenance.states.findOne({projectId:filmA});
 assert.equal(await registry.countDocuments({projectId:filmB}),0);
 assert.equal(await projects.countDocuments({_id:filmB}),0);
 assert.equal((await create(filmB)).status,201);
 assert.equal((await create(filmB)).status,200);
 assert.equal((await create(filmB,foreign)).status,403);
 assert.equal((await registration.register({token:foreign,projectId:filmB})).ok,false);
 assert.deepEqual(await registration.register({token:owner,projectId:filmB}),{ok:true,projectId:filmB,replayed:false});
 assert.deepEqual(await registration.register({token:owner,projectId:filmB}),{ok:true,projectId:filmB,replayed:true});
 assert.equal(await registry.countDocuments({projectId:filmB}),1);
 assert.equal(await provenance.ledger.countDocuments({projectId:filmB}),1);
 const selected=await selection.read({token:owner,projectId:vaultId});
 assert.equal((await selection.select({token:owner,projectId:vaultId,operationId:'select-new-film',expectedRevision:selected.revision,nextActiveProjectId:filmB})).ok,true);
 assert.equal((await selection.read({token:owner,projectId:vaultId})).activeProjectId,filmB);
 assert.deepEqual((await projects.findOne({_id:filmB})).state,{scenes:[],conversationMessages:[]});
 assert.deepEqual(await provenance.states.findOne({projectId:filmA}),before);
 console.log('GREEN PHYSICAL_PINNED_NATIVE_HTTP_NEW_FILM_OWNERSHIP_REGISTRATION_SELECTION');
 console.log('GREEN PHYSICAL_NEW_FILM_EMPTY_HISTORY_ORIGINAL_FILM_UNCHANGED');
 const transport=async({path,token,body})=>{const r=await fetch('http://127.0.0.1:'+server.address().port+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});return r.json()};
 const factory=createApplicationStudioSessionFactory({transport,resolveSelectionVaultId:async({token})=>(await vaults.resolve({token})).vaultId,readLocalBytes:()=>'unchanged-local-bytes'});
 const session=factory({getAuthToken:async()=>owner});const opened=await session.open();assert.equal(opened.ok,true);
 const filmC='movie-project-'+randomUUID();
 assert.equal(await registry.countDocuments({projectId:filmC}),0);
 const newFilm=await opened.services.createNativeFilm({projectId:filmC,operationId:'select-film-c'});
 assert.equal(newFilm.ok,true,JSON.stringify(newFilm));assert.equal(newFilm.view.writable,false);
 assert.deepEqual((await projects.findOne({_id:filmC})).state,{scenes:[],conversationMessages:[]});
 assert.equal((await opened.services.createNativeFilm({projectId:filmC,operationId:'select-film-c'})).ok,true);
 assert.equal(await registry.countDocuments({projectId:filmC}),1);
 assert.equal(await provenance.ledger.countDocuments({projectId:filmC}),1);
 session.invalidate();
 assert.equal((await opened.services.createNativeFilm({projectId:'movie-project-'+randomUUID(),operationId:'stale'})).ok,false);
 const fresh=factory({getAuthToken:async()=>owner});const reopened=await fresh.open();assert.equal(reopened.ok,true);
 assert.equal((await reopened.services.applicationSecondFilm.reopen({token:owner,selectionVaultId:vaultId,projectId:filmC})).ok,true);
 const switchBack=await reopened.services.applicationSecondFilm.choose({token:owner,selectionVaultId:vaultId,nextProjectId:filmA,selectionOperationId:'return-film-a',localMemory:{getState:()=>({})}});
 assert.equal(switchBack.ok,true,JSON.stringify(switchBack));
 assert.deepEqual(await provenance.states.findOne({projectId:filmA}),before);
 console.log('GREEN PHYSICAL_AUTHENTICATED_APPLICATION_SESSION_NATIVE_CREATION_REPLAY_AND_SWITCH_BACK');
 const inputs=[];
 for(const [id,label] of [[filmB,'Second film only'],[filmC,'Third film only']]){
  const selected=await selection.read({token:owner,projectId:vaultId});
  assert.equal((await selection.select({token:owner,projectId:vaultId,expectedRevision:selected.revision,operationId:'conversation-select-'+id,nextActiveProjectId:id})).ok,true);
  const g=await provenance.issue({token:owner,projectId:id,revision:1});assert.ok(g?.grantId);
  const admissionId='conversation-admit-'+id;
  const admission=await gate.admit({token:owner,projectId:id,grantId:g.grantId,operationId:admissionId,revision:1});assert.equal(admission.acquired,true);
  const body={projectId:id,selectionVaultId:vaultId,operationId:admissionId+':turn',creatorTurnId:'same-turn-id',expectedRevision:1,fence:admission.fence,creatorMessage:{id:'same-turn-id',role:'creator',text:label},mentorMessage:{id:'same-mentor-id',role:'mentor',text:'Reply to '+label,metadata:{backendMetadata:{creatorTurnId:'same-turn-id'}}}};
  assert.equal((await transport({path:'/studio/native-conversation-settle',token:foreign,body})).ok,false);
  const result=await reopened.services.studioServices.request('/studio/native-conversation-settle',body);assert.equal(result.ok,true,JSON.stringify(result));
  const replay=await reopened.services.studioServices.request('/studio/native-conversation-settle',body);assert.equal(replay.replay,true);assert.equal(replay.serverCommitId,result.serverCommitId);
  assert.equal((await reopened.services.studioServices.request('/studio/native-conversation-settle',{...body,mentorMessage:{...body.mentorMessage,text:'tampered'}})).ok,false);
  assert.equal(await receipts.countDocuments({projectId:id}),1);
  assert.deepEqual((await projects.findOne({_id:id})).state.conversationMessages,[body.creatorMessage,body.mentorMessage]);
  inputs.push(body);
 }
 assert.equal((await reopened.services.studioServices.request('/studio/native-conversation-settle',inputs[0])).ok,false);
 assert.deepEqual(await provenance.states.findOne({projectId:filmA}),before);
 // Independent OS process reads the durable Mongo records, not the parent heap.
 const child=spawnSync(process.execPath,['--input-type=module','-e',`import assert from 'node:assert/strict';import {MongoClient} from 'mongodb';const c=new MongoClient(process.env.MONGO_URI);await c.connect();try{const d=c.db('isolated_native_film_registration');for(const x of JSON.parse(process.env.EXPECTED_CONVERSATIONS)){const p=await d.collection('projects').findOne({_id:x.projectId});const s=await d.collection('provenance_states').findOne({projectId:x.projectId});assert.equal(p.revision,2);assert.deepEqual(p.state.conversationMessages,[x.creatorMessage,x.mentorMessage]);assert.deepEqual(s.state.content,p.state);assert.equal(await d.collection('native_conversation_receipts').countDocuments({projectId:x.projectId}),1)}}finally{await c.close()}`],{env:{...process.env,EXPECTED_CONVERSATIONS:JSON.stringify(inputs)},encoding:'utf8',timeout:30000});
 assert.equal(child.status,0,child.stderr||child.error?.message);
 console.log('GREEN PHYSICAL_NATIVE_TWO_FILM_ATOMIC_CONVERSATION_SETTLEMENT_AND_REPLAY');
 console.log('GREEN PHYSICAL_NATIVE_TWO_FILM_FRESH_PROCESS_DURABLE_READBACK');
 await new Promise(r=>server.close(r));server=null;
 const restarted=spawnSync(process.execPath,['./verify-physical-native-film-registration.mjs'],{env:{...process.env,NATIVE_RECOVERY_PUBLIC_KEY:publicKey.export({type:'spki',format:'pem'}),NATIVE_RECOVERY_OWNER_ID:ownerId,NATIVE_RECOVERY_OWNER_TOKEN:owner,NATIVE_RECOVERY_FOREIGN_TOKEN:foreign,EXPECTED_CONVERSATIONS:JSON.stringify(inputs)},encoding:'utf8',timeout:180000});
 process.stdout.write(restarted.stdout||'');process.stderr.write(restarted.stderr||'');assert.equal(restarted.status,0,restarted.error?.message||restarted.stderr);
 console.log('HELD NATIVE_COCKPIT_EDITING_AND_REAL_ROUTE_SESSION_ADOPTION');
 }
}finally{if(server)await new Promise(r=>server.close(r));await mongoose.disconnect();await client.close()}
