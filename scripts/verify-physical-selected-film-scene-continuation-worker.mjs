// Physically mount exact pinned CreatorWorkspace with an isolated Studio lifecycle
// controller, HTTP owner authentication and real Mongo readback. Disposable only.
import assert from 'node:assert/strict';
import {MongoClient} from 'mongodb';
import {createServer} from 'node:http';
import {createPublicKey,verify} from 'node:crypto';
import {readFileSync,writeFileSync,rmSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {transformPinnedStudioMessageHandler} from './isolated-studio-real-handler-adoption-candidate.mjs';
import {createProvenanceAuthority} from './isolated-server-publication-provenance.mjs';
import {createWritableAdmissionGate} from './isolated-writable-admission-gate.mjs';
import {createServerProjectSelectionAuthority} from './isolated-server-original-red-project-selection.mjs';
const client=new MongoClient(process.env.MONGO_URI,{serverSelectionTimeoutMS:12000});await client.connect();
const db=client.db('isolated_studio_selected_film_continuation');
const projects=db.collection('projects'),receipts=db.collection('receipts'),grants=db.collection('writer_grants');
const key=createPublicKey(process.env.PUBLIC_KEY_PEM);
const base='__selected_film_continuation_physical';
const files=['../frontend/'+base+'.html','../frontend/'+base+'_entry.jsx','../frontend/'+base+'_vite.config.mjs','../frontend/src/components/studio/'+base+'.jsx','../frontend/'+base+'_runtime.mjs'];
const phase=process.argv[2];assert.ok(['seed','continue','recover'].includes(phase));
const selectionProjectId='physical-studio-selection-vault';
const provenance=createProvenanceAuthority({db,client,publicKey:key});
const selectionGate=createWritableAdmissionGate({db,client,publicKey:key});
const selectionAuthority=createServerProjectSelectionAuthority({gate:selectionGate,db,client});
let server,vite,browser;
const authenticate=header=>{
 try{const parts=header?.slice(7).split('.');if(!header.startsWith('Bearer ')||parts.length!==3)return null;const h=JSON.parse(Buffer.from(parts[0],'base64url'));const p=JSON.parse(Buffer.from(parts[1],'base64url'));const now=Math.floor(Date.now()/1000);if(h.alg!=='RS256'||p.iss!=='https://isolated-auth.test'||p.aud!=='movie-mentor-creator-write'||p.exp<=now||p.nbf>now)return null;return verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),key,Buffer.from(parts[2],'base64url'))?p.sub:null}catch{return null}
};
const readJson=async req=>{let s='';for await(const c of req){s+=c;if(s.length>32768)throw Error('too-large')}return JSON.parse(s)};
try{
 if(phase==='seed'){
  await Promise.all([projects.deleteMany({}),receipts.deleteMany({}),grants.deleteMany({}),provenance.states.deleteMany({projectId:selectionProjectId}),provenance.ledger.deleteMany({projectId:selectionProjectId}),provenance.grants.deleteMany({projectId:selectionProjectId}),selectionAuthority.receipts.deleteMany({projectId:selectionProjectId})]);
  await receipts.createIndex({projectId:1,operationId:1},{unique:true});
  await grants.createIndex({projectId:1,operationId:1},{unique:true});
  await projects.insertMany([{_id:'film-a',ownerId:'owner-1',revision:1,state:{scenes:[{id:'scene-one',text:'Opening scene'}]}},{_id:'film-b',ownerId:'owner-1',revision:3,state:{scenes:[]}}]);
  await provenance.ledger.createIndex({projectId:1,operationId:1},{unique:true});
  await selectionAuthority.receipts.createIndex({projectId:1,operationId:1},{unique:true});
  await provenance.states.insertOne({projectId:selectionProjectId,ownerId:'owner-1',revision:0,ownershipRevision:1,revoked:false,state:{content:{activeProjectId:'film-a',projects:[{id:'film-a',ownerId:'owner-1'},{id:'film-b',ownerId:'owner-1'}]},durablePublicationOutbox:[]}});
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
  const panel='<section aria-label="Studio selected-film continuation court"><button onClick={()=>void globalThis.__serverSelection.load({token:globalThis.__diagnosticToken,projectId:"physical-studio-selection-vault"})}>Load owned film selection</button><button onClick={()=>void globalThis.__serverSelection.change({token:globalThis.__diagnosticToken,projectId:"physical-studio-selection-vault",operationId:"select-film-b",nextActiveProjectId:"film-b"})}>Confirm film B</button><button onClick={()=>void globalThis.__serverSelection.change({token:globalThis.__diagnosticToken,projectId:"physical-studio-selection-vault",operationId:"select-unowned",nextActiveProjectId:"unowned-film"})}>Reject unowned film</button><button onClick={()=>void globalThis.__studioLifecycle.select("film-b")}>Read selected film B for scene</button><button onClick={()=>void globalThis.__studioLifecycle.requestWritable({operationId:"adopt-film-b"})}>Admit selected film B writer</button><button onClick={()=>handleMovieMessage({id:"turn-b-next",role:"creator",text:"Continue selected Film B"})}>Creator Film B scene request</button><button onClick={()=>handleMovieMessage({id:"scene-b-next",role:"mentor",text:"Film B next confirmed scene",metadata:{backendMetadata:{creatorTurnId:"turn-b-next"}}})}>Mentor Film B scene</button><output aria-label="Server-authorised movie selection">{__diagnosticSelectionView?.activeProjectId||"none"} | {__diagnosticSelectionView?.revision??"none"}</output><output aria-label="Studio active movie">{activeMovieProject?.id||"none"}</output><output aria-label="Selected film durable lifecycle">{__diagnosticLifecycleView?.projectId||"none"} | {__diagnosticLifecycleView?.phase||"blocked"} | {__diagnosticLifecycleView?.committed?.state?.scenes?.map(s=>s.text).join(" / ")||""}</output><output aria-label="Selected film conversation projection">{movieMessages.map(m=>m.text).join(" / ")}</output></section>';
  // Use a normal React state subscription so the projection is observable.
  const stateAnchor='const [movieMessages, setMovieMessages] = useState(resumeSnapshot?.conversationMessages || []);';
  assert.ok(source.includes(stateAnchor));
  const insert='const [__diagnosticLifecycleView, __setDiagnosticLifecycleView] = useState(null); globalThis.__diagnosticStudioView = __setDiagnosticLifecycleView; const [__diagnosticSelectionView,__setDiagnosticSelectionView]=useState(null);globalThis.__diagnosticSelectionView=(v)=>{__setDiagnosticSelectionView(v);setActiveMovieProject(v?.activeProjectId?{id:v.activeProjectId}:null);};';
  let candidate=transformPinnedStudioMessageHandler(source);
  const projectAnchor='const [activeMovieProject, setActiveMovieProject] = useState(resumeSnapshot?.project || null);';
  assert.ok(candidate.includes(projectAnchor));
  candidate=candidate.replace(projectAnchor,'const [activeMovieProject, setActiveMovieProject] = useState({id:"film-a"});');
  candidate=candidate.replace(stateAnchor,stateAnchor+'\n  '+insert).replace('<main style={styles.workspace}>','<main style={styles.workspace}>'+panel.replaceAll('globalThis.__studioLifecycleResult?.','__diagnosticLifecycleView?.'));
  writeFileSync(files[3],candidate);
  writeFileSync(files[4],readFileSync('./isolated-real-studio-lifecycle-handoff.mjs','utf8'));
  const selectionModule='../frontend/'+base+'_selection.mjs';files.push(selectionModule);
  writeFileSync(selectionModule,readFileSync('./isolated-studio-server-selection-adoption.mjs','utf8'));
  writeFileSync(files[1],`import React from 'react';import {createRoot} from 'react-dom/client';import CreatorWorkspace from './src/components/studio/${base}.jsx';import {createIsolatedStudioLifecycleCoordinator} from './${base}_runtime.mjs';import {createIsolatedStudioServerSelectionAdoption} from './${base}_selection.mjs';const request=async(path,data)=>{const r=await fetch(path,{method:'POST',headers:{authorization:'Bearer '+globalThis.__diagnosticToken,'content-type':'application/json'},body:JSON.stringify(data)});return r.json()};const authority={readProject:id=>request('/studio/read',{projectId:id}),admit:x=>request('/studio/admit',x),saveScene:x=>request('/studio/save',x),readCommitted:x=>request('/studio/read-committed',x)};globalThis.__studioLifecycle=createIsolatedStudioLifecycleCoordinator({authority,view:s=>globalThis.__diagnosticStudioView?.(s)});globalThis.__diagnosticStudioLifecycle=globalThis.__studioLifecycle;globalThis.__serverSelection=createIsolatedStudioServerSelectionAdoption({authority:{read:x=>request('/studio/selection-read',x),select:x=>request('/studio/selection-change',x)},onCommitted:x=>globalThis.__diagnosticSelectionView?.(x)});createRoot(document.getElementById('root')).render(<CreatorWorkspace creatorName="Diagnostic Creator" />);`);
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
  const shown=page.getByLabel('Server-authorised movie selection');
  const active=page.getByLabel('Studio active movie');
  async function contains(value){for(let i=0;i<120;i++){if((await shown.textContent()||'').includes(value))return;await delay(50)}throw Error('expected '+value+' but got '+await shown.textContent())}
  await page.getByRole('button',{name:'Load owned film selection'}).click();
  if(phase==='continue'){
    await contains('film-a | 1');
    assert.match(await active.textContent(),/film-a/);
    await page.getByRole('button',{name:'Reject unowned film'}).click();
    await delay(150);
    assert.match(await shown.textContent(),/film-a \| 1/);
    assert.equal((await selectionAuthority.read({token:process.env.OWNER_TOKEN,projectId:selectionProjectId})).activeProjectId,'film-a');
    console.log('GREEN PHYSICAL_STUDIO_UNOWNED_SELECTION_REFUSED_WITHOUT_REACT_PROJECTION');
    await page.getByRole('button',{name:'Confirm film B'}).click();
    await contains('film-b | 2');
    assert.match(await active.textContent(),/film-b/);
    assert.equal((await selectionAuthority.read({token:process.env.OWNER_TOKEN,projectId:selectionProjectId})).activeProjectId,'film-b');
    assert.equal(await selectionAuthority.receipts.countDocuments({projectId:selectionProjectId}),1);
    console.log('GREEN PHYSICAL_REACT_HTTP_MONGO_SERVER_SELECTION_CONFIRMED_AND_ADOPTED');
    const lifecycleShown=page.getByLabel('Selected film durable lifecycle');
    const projected=page.getByLabel('Selected film conversation projection');
    await page.getByRole('button',{name:'Read selected film B for scene'}).click();
    for(let i=0;i<120;i++){if((await lifecycleShown.textContent()||'').includes('film-b | read-only'))break;await delay(40)}
    assert.match(await lifecycleShown.textContent(),/film-b \| read-only/);
    await page.getByRole('button',{name:'Admit selected film B writer'}).click();
    for(let i=0;i<120;i++){if((await lifecycleShown.textContent()||'').includes('film-b | writable'))break;await delay(40)}
    assert.match(await lifecycleShown.textContent(),/film-b \| writable/);
    await page.getByRole('button',{name:'Creator Film B scene request'}).click();
    for(let i=0;i<120;i++){if((await projected.textContent()||'').includes('Continue selected Film B'))break;await delay(40)}
    assert.match(await projected.textContent(),/Continue selected Film B/);
    assert.doesNotMatch(await projected.textContent(),/Film B next confirmed scene/);
    await page.getByRole('button',{name:'Mentor Film B scene'}).click();
    for(let i=0;i<120;i++){if((await projected.textContent()||'').includes('Film B next confirmed scene'))break;await delay(40)}
    assert.match(await projected.textContent(),/Film B next confirmed scene/);
    assert.equal(await page.evaluate(()=>globalThis.__diagnosticStudioPending?.size||0),0);
    const filmB=await projects.findOne({_id:'film-b'});
    const filmA=await projects.findOne({_id:'film-a'});
    assert.equal(filmB.revision,4);assert.deepEqual(filmB.state.scenes,[{id:'scene-b-next',text:'Film B next confirmed scene'}]);
    assert.equal(filmA.revision,1);assert.equal(filmA.state.scenes.length,1);
    assert.equal(await receipts.countDocuments({projectId:'film-b'}),1);
    assert.equal(await receipts.countDocuments({projectId:'film-a'}),0);
    console.log('GREEN PHYSICAL_SELECTED_FILM_B_REAL_HANDLER_NEXT_SCENE_DURABLE_SETTLEMENT');
    console.log('GREEN PHYSICAL_SELECTED_FILM_CROSS_PROJECT_ISOLATION_AND_SINGLE_RECEIPT');
  }else{
    await contains('film-b | 2');
    assert.match(await active.textContent(),/film-b/);
    const replay=await selectionAuthority.select({token:process.env.OWNER_TOKEN,projectId:selectionProjectId,operationId:'select-film-b',expectedRevision:1,nextActiveProjectId:'film-b'});
    assert.equal(replay.ok,true);assert.equal(replay.replayed,true);
    assert.equal(await selectionAuthority.receipts.countDocuments({projectId:selectionProjectId}),1);
    console.log('GREEN PHYSICAL_STUDIO_FRESH_BROWSER_PROJECT_SELECTION_READBACK_AND_REPLAY');
    await page.getByRole('button',{name:'Read selected film B for scene'}).click();
    const lifecycleShown=page.getByLabel('Selected film durable lifecycle');
    for(let i=0;i<120;i++){if((await lifecycleShown.textContent()||'').includes('Film B next confirmed scene'))break;await delay(40)}
    assert.match(await lifecycleShown.textContent(),/Film B next confirmed scene/);
    const replayed=await fetch('http://127.0.0.1:'+server.address().port+'/studio/read-committed',{method:'POST',headers:{authorization:'Bearer '+process.env.OWNER_TOKEN,'content-type':'application/json'},body:JSON.stringify({projectId:'film-b',operationId:'adopt-film-b:turn-b-next'})});
    assert.equal(replayed.status,200);
    const receipt=await replayed.json();
    assert.equal(receipt.revision,4);assert.equal(receipt.state.scenes.length,1);
    assert.equal(await receipts.countDocuments({projectId:'film-b'}),1);
    assert.equal((await projects.findOne({_id:'film-b'})).revision,4);
    assert.equal((await projects.findOne({_id:'film-a'})).revision,1);
    console.log('GREEN PHYSICAL_FILM_B_FRESH_BROWSER_SCENE_RECOVERY_WITHOUT_DUPLICATE');
  }
  assert.deepEqual(pageErrors,[]);
  const intruder=await fetch('http://127.0.0.1:'+server.address().port+'/studio/read',{method:'POST',headers:{authorization:'Bearer '+process.env.INTRUDER_TOKEN,'content-type':'application/json'},body:JSON.stringify({projectId:'film-a'})});
  assert.equal(intruder.status,403);
  console.log('GREEN PHYSICAL_STUDIO_SELECTION_INTRUDER_DENIED');
  console.log('HELD ORIGINAL_FRONTEND_RED_AND_PRODUCTION_APPLICATION_ADOPTION');
 } 
}finally{
 if(browser)await browser.close();
 if(vite){vite.kill('SIGTERM');for(let i=0;i<30&&vite.exitCode===null;i++)await delay(100);if(vite.exitCode===null)vite.kill('SIGKILL')}
 for(const f of files)rmSync(f,{force:true});
 if(server?.listening)await new Promise(resolve=>server.close(resolve));
 await client.close();
}
