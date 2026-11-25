// Physical integration with unchanged pinned native ingress and registry.
import assert from 'node:assert/strict';
import {randomUUID,generateKeyPairSync,sign,verify,createPublicKey,createHash} from 'node:crypto';
import express from 'express';
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
 app.post('/studio/native-conversation-settle',async(req,res)=>res.json(await settlement.settleConversation({...req.body,token:req.get('authorization')?.replace(/^Bearer /,'')})));
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
    return current.activeProjectId===id?app.applicationSecondFilm.reopen({token:owner,selectionVaultId:vaultId,projectId:id}):app.applicationSecondFilm.choose({token:owner,selectionVaultId:vaultId,nextProjectId:id,selectionOperationId:'browser-switch-'+randomUUID(),localMemory:{getState:()=>({})}});
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
   assert.equal(await receipts.countDocuments({projectId:created}),2);
   browserSession?.invalidate();
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
