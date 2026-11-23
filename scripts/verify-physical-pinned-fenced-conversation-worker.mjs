// Physically mount exact pinned CreatorWorkspace with an isolated Studio lifecycle
// controller, HTTP owner authentication and real Mongo readback. Disposable only.
import assert from 'node:assert/strict';
import {MongoClient} from 'mongodb';
import {createServer} from 'node:http';
import {createPublicKey,verify} from 'node:crypto';
import {readFileSync,writeFileSync,rmSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {transformPinnedFencedConversationHandler} from './isolated-pinned-fenced-conversation-handler-candidate.mjs';
import {createProvenanceAuthority} from './isolated-server-publication-provenance.mjs';
import {createWritableAdmissionGate} from './isolated-writable-admission-gate.mjs';
import {createServerProjectSelectionAuthority} from './isolated-server-original-red-project-selection.mjs';
import {createPhysicalProvenanceFencedSceneSettlement} from './isolated-physical-provenance-fenced-scene-settlement.mjs';
const client=new MongoClient(process.env.MONGO_URI,{serverSelectionTimeoutMS:12000});await client.connect();
const db=client.db('isolated_pinned_fenced_conversation_recovery');
const projects=db.collection('projects'),receipts=db.collection('receipts'),grants=db.collection('writer_grants');
const key=createPublicKey(process.env.PUBLIC_KEY_PEM);
const base='__pinned_fenced_conversation_physical';
const files=['../frontend/'+base+'.html','../frontend/'+base+'_entry.jsx','../frontend/'+base+'_vite.config.mjs','../frontend/src/components/studio/'+base+'.jsx','../frontend/'+base+'_runtime.mjs'];
const phase=process.argv[2];assert.ok(['seed','save','recover'].includes(phase));
const selectionProjectId='physical-studio-selection-vault';
const provenance=createProvenanceAuthority({db,client,publicKey:key});
const selectionGate=createWritableAdmissionGate({db,client,publicKey:key});
const selectionAuthority=createServerProjectSelectionAuthority({gate:selectionGate,db,client});
const sceneAuthority=createPhysicalProvenanceFencedSceneSettlement({client,gate:selectionGate,projects,receipts});
let server,vite,browser;
const authenticate=header=>{
 try{const parts=header?.slice(7).split('.');if(!header.startsWith('Bearer ')||parts.length!==3)return null;const h=JSON.parse(Buffer.from(parts[0],'base64url'));const p=JSON.parse(Buffer.from(parts[1],'base64url'));const now=Math.floor(Date.now()/1000);if(h.alg!=='RS256'||p.iss!=='https://isolated-auth.test'||p.aud!=='movie-mentor-creator-write'||p.exp<=now||p.nbf>now)return null;return verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),key,Buffer.from(parts[2],'base64url'))?p.sub:null}catch{return null}
};
const readJson=async req=>{let s='';for await(const c of req){s+=c;if(s.length>32768)throw Error('too-large')}return JSON.parse(s)};
try{
 if(phase==='seed'){
  await Promise.all([projects.deleteMany({}),receipts.deleteMany({}),grants.deleteMany({}),provenance.states.deleteMany({}),provenance.ledger.deleteMany({}),provenance.grants.deleteMany({}),selectionGate.admissions.deleteMany({}),selectionAuthority.receipts.deleteMany({projectId:selectionProjectId})]);
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
  console.log('GREEN PHYSICAL_STUDIO_SELECTION_SIGNED_MONGO_PROVENANCE_SEEDED');
 }else{
  server=createServer(async(req,res)=>{
   const reply=(code,data)=>{if(res.writableEnded)return;res.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data))};
   if(req.method!=='POST'||!req.url.startsWith('/studio/'))return reply(404,{ok:false});
   const owner=authenticate(req.headers.authorization);if(!owner)return reply(401,{ok:false});
   try{
    const input=await readJson(req);
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
  const panel='<section aria-label="Physical application editable admission"><button onClick={()=>void globalThis.__serverSelection.load({token:globalThis.__diagnosticToken,projectId:"physical-studio-selection-vault"})}>Load film selection</button><button onClick={()=>void globalThis.__serverSelection.change({token:globalThis.__diagnosticToken,projectId:"physical-studio-selection-vault",operationId:"select-film-b",nextActiveProjectId:"film-b"})}>Select Film B</button><button onClick={()=>void globalThis.__applicationRecovery.inspect({token:globalThis.__diagnosticToken,selectionVaultId:"physical-studio-selection-vault",projectId:"film-b"})}>Recover Film B</button><button onClick={()=>void globalThis.__applicationEditable.activate({token:globalThis.__diagnosticToken,selectionVaultId:"physical-studio-selection-vault",readOnlySnapshot:globalThis.__applicationRecovery.getSnapshot(),operationId:"adopt-film-b"})}>Request server editing authority</button><output aria-label="Server selection">{__diagnosticSelectionView?.activeProjectId||"none"} | {__diagnosticSelectionView?.revision??"none"}</output><output aria-label="Recovered film">{__diagnosticApplicationView?.projectId||"none"} | {__diagnosticApplicationView?.projectRevision??"none"} | {__diagnosticApplicationView?.scenes?.map(s=>s.text).join(" / ")||""}</output><output aria-label="Server editable authority">{__diagnosticEditableView?.projectId||"none"} | {__diagnosticEditableView?.revision??"none"} | {__diagnosticEditableView?.writable?"writable":"blocked"}</output><button onClick={()=>handleMovieMessage({id:"creator-turn-new",role:"creator",text:"Continue Film B in real handler"})}>Creator handler turn</button><button onClick={()=>handleMovieMessage({id:"mentor-mentor-scene-new",role:"mentor",text:"Film B conversation scene",metadata:{backendMetadata:{creatorTurnId:"creator-turn-new"}}})}>Mentor handler scene</button><output aria-label="Creator message display">{movieMessages.map(m=>m.text).join(" / ")}</output><output aria-label="Local movie identity">{activeMovieProject?.id||"none"}</output></section>';
  // Use a normal React state subscription so the projection is observable.
  const stateAnchor='const [movieMessages, setMovieMessages] = useState(resumeSnapshot?.conversationMessages || []);';
  assert.ok(source.includes(stateAnchor));
  const insert='const [__diagnosticLifecycleView, __setDiagnosticLifecycleView] = useState(null);globalThis.__diagnosticStudioView=__setDiagnosticLifecycleView;const [__diagnosticSelectionView,__setDiagnosticSelectionView]=useState(null);globalThis.__diagnosticSelectionView=__setDiagnosticSelectionView;const [__diagnosticApplicationView,__setDiagnosticApplicationView]=useState(null);globalThis.__diagnosticApplicationView=__setDiagnosticApplicationView;const [__diagnosticEditableView,__setDiagnosticEditableView]=useState(null);globalThis.__diagnosticEditableView=(v)=>{__setDiagnosticEditableView(v);setActiveMovieProject(v?.projectId?{id:v.projectId}:null);};';
  let candidate=transformPinnedFencedConversationHandler(source);
  const projectAnchor='const [activeMovieProject, setActiveMovieProject] = useState(resumeSnapshot?.project || null);';
  assert.ok(candidate.includes(projectAnchor));
  candidate=candidate.replace(projectAnchor,'const [activeMovieProject, setActiveMovieProject] = useState({id:"film-a"});');
  candidate=candidate.replace(stateAnchor,stateAnchor+'\n  '+insert).replace('<main style={styles.workspace}>','<main style={styles.workspace}>'+panel.replaceAll('globalThis.__studioLifecycleResult?.','__diagnosticLifecycleView?.'));
  writeFileSync(files[3],candidate);
  writeFileSync(files[4],readFileSync('./isolated-real-studio-lifecycle-handoff.mjs','utf8'));
  const selectionModule='../frontend/'+base+'_selection.mjs';files.push(selectionModule);
  writeFileSync(selectionModule,readFileSync('./isolated-studio-server-selection-adoption.mjs','utf8'));
  const editableModule='../frontend/'+base+'_editable.mjs';files.push(editableModule);writeFileSync(editableModule,readFileSync('./isolated-application-editable-adoption-boundary.mjs','utf8'));
  const applicationModule='../frontend/'+base+'_application.mjs';files.push(applicationModule);writeFileSync(applicationModule,readFileSync('./isolated-application-recovery-adoption-boundary.mjs','utf8'));
  writeFileSync(files[1],`import React from 'react';import {createRoot} from 'react-dom/client';import CreatorWorkspace from './src/components/studio/${base}.jsx';import {createIsolatedStudioLifecycleCoordinator} from './${base}_runtime.mjs';import {createIsolatedStudioServerSelectionAdoption} from './${base}_selection.mjs';import {createIsolatedApplicationRecoveryAdoption} from './${base}_application.mjs';import {createIsolatedApplicationEditableAdoption} from './${base}_editable.mjs';const request=async(path,data)=>{const r=await fetch(path,{method:'POST',headers:{authorization:'Bearer '+globalThis.__diagnosticToken,'content-type':'application/json'},body:JSON.stringify(data)});return r.json()};const authority={readProject:id=>request('/studio/read',{projectId:id}),admit:x=>request('/studio/admit',x),saveScene:x=>request('/studio/save',x),readCommitted:x=>request('/studio/read-committed',x)};globalThis.__studioLifecycle=createIsolatedStudioLifecycleCoordinator({authority,view:s=>globalThis.__diagnosticStudioView?.(s)});globalThis.__diagnosticStudioLifecycle=globalThis.__studioLifecycle;globalThis.__serverSelection=createIsolatedStudioServerSelectionAdoption({authority:{read:x=>request('/studio/selection-read',x),select:x=>request('/studio/selection-change',x)},onCommitted:x=>globalThis.__diagnosticSelectionView?.(x)});globalThis.__applicationRecovery=createIsolatedApplicationRecoveryAdoption({readSelected:x=>request('/studio/selection-read',x),readProject:x=>request('/studio/read',x),onVerifiedReadOnly:x=>globalThis.__diagnosticApplicationView?.(x)});globalThis.__applicationEditable=createIsolatedApplicationEditableAdoption({readSelected:x=>request('/studio/selection-read',x),readProject:x=>request('/studio/read',x),issueGrant:x=>request('/studio/publication-grant',x),admit:x=>request('/studio/admit-publication',x),readAdmission:x=>request('/studio/read-admission',x),onVerifiedEditable:x=>globalThis.__diagnosticEditableView?.(x)});globalThis.__diagnosticFencedRequest=request;createRoot(document.getElementById('root')).render(<CreatorWorkspace creatorName="Diagnostic Creator" />);`);
  writeFileSync(files[0],`<html><body><div id="root"></div><script type="module" src="/${base}_entry.jsx"></script></body></html>`);
  writeFileSync(files[2],`import {defineConfig} from 'vite';import react from '@vitejs/plugin-react-swc';export default defineConfig({plugins:[react()],server:{proxy:{'/studio':{target:'http://127.0.0.1:${server.address().port}',changeOrigin:true}}}});`);
  vite=spawn('./node_modules/.bin/vite',['--host','127.0.0.1','--port','52767','--strictPort','--config',base+'_vite.config.mjs'],{cwd:'../frontend',stdio:['ignore','pipe','pipe']});
  let errors='';vite.stderr.on('data',c=>errors+=c);vite.stdout.on('data',c=>errors+=c);
  let ready=false;for(let i=0;i<100;i++){if(vite.exitCode!==null)throw Error('vite-failed '+errors.slice(-1200));try{if((await fetch('http://127.0.0.1:52767/'+base+'.html')).ok){ready=true;break}}catch{}await delay(150)}
  assert.ok(ready,'vite-not-ready '+errors.slice(-1200));
  const {chromium}=await import('playwright');browser=await chromium.launch({headless:true});
  const page=await browser.newPage(),pageErrors=[];page.on('pageerror',e=>pageErrors.push(String(e)));
  await page.addInitScript(token=>globalThis.__diagnosticToken=token,process.env.OWNER_TOKEN);
  await page.goto('http://127.0.0.1:52767/'+base+'.html');
  await page.getByRole('heading',{name:/Welcome back, Diagnostic Creator/}).waitFor({timeout:15000});
  const selected=page.getByLabel('Server selection'),recovered=page.getByLabel('Recovered film'),editable=page.getByLabel('Server editable authority'),local=page.getByLabel('Local movie identity');
  async function poll(loc,word){for(let i=0;i<120;i++){if((await loc.textContent()||'').includes(word))return;await delay(40)}throw Error('expected '+word+' got '+await loc.textContent())}
  await page.getByRole('button',{name:'Load film selection'}).click();
  if(phase==='save'){
   await poll(selected,'film-a | 1');
   await page.getByRole('button',{name:'Select Film B'}).click();await poll(selected,'film-b | 2');
   await page.getByRole('button',{name:'Recover Film B'}).click();await poll(recovered,'Film B next confirmed scene');
   assert.match(await local.textContent(),/film-a/);
   await page.getByRole('button',{name:'Request server editing authority'}).click();
   await poll(editable,'film-b | 4 | writable');
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
  }else{
   await poll(selected,'film-b | 2');
   await page.getByRole('button',{name:'Recover Film B'}).click();
   await poll(recovered,'Film B conversation scene');
   assert.match(await local.textContent(),/film-a/);
   assert.match(await editable.textContent(),/none/);
   const prior=await receipts.findOne({projectId:'film-b',operationId:'adopt-film-b:scene-new'});
   assert.ok(prior?.fence);
   const readback=await sceneAuthority.readCommitted({token:process.env.OWNER_TOKEN,projectId:'film-b',operationId:'adopt-film-b:scene-new'});
   assert.equal(readback?.revision,5);
   assert.equal(readback?.serverCommitId,prior.commitId);
   assert.equal(readback?.state.scenes.length,2);
   assert.equal(await sceneAuthority.readCommitted({token:process.env.INTRUDER_TOKEN,projectId:'film-b',operationId:'adopt-film-b:scene-new'}),null);
   const replay=await sceneAuthority.save({token:process.env.OWNER_TOKEN,projectId:'film-b',operationId:'adopt-film-b:scene-new',fence:prior.fence,expectedRevision:4,scene:prior.scene});
   assert.equal(replay.ok,true);
   assert.equal(replay.replay,true);
   const altered=await sceneAuthority.save({token:process.env.OWNER_TOKEN,projectId:'film-b',operationId:'adopt-film-b:scene-new',fence:prior.fence,expectedRevision:4,scene:{id:'scene-new',text:'tamper'}});
   assert.equal(altered.ok,false);
   const stale=await sceneAuthority.save({token:process.env.OWNER_TOKEN,projectId:'film-b',operationId:'adopt-film-b:duplicate',fence:prior.fence,expectedRevision:4,scene:{id:'other',text:'duplicate'}});
   assert.equal(stale.ok,false);
   assert.equal(await receipts.countDocuments({projectId:'film-b'}),1);
   assert.equal(await provenance.ledger.countDocuments({projectId:'film-b'}),5);
   assert.equal((await projects.findOne({_id:'film-b'})).revision,5);
   assert.equal((await projects.findOne({_id:'film-a'})).revision,1);
   console.log('GREEN PHYSICAL_REAL_HANDLER_FRESH_BROWSER_READBACK_AND_EXACTLY_ONCE_REPLAY');
   console.log('GREEN PHYSICAL_REAL_HANDLER_TAMPER_STALE_AND_INTRUDER_DENIAL');
  }
  assert.deepEqual(pageErrors,[]);
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
