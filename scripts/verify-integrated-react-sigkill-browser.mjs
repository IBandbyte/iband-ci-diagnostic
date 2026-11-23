import assert from 'node:assert/strict';
import {MongoClient} from 'mongodb';
import {readFileSync,writeFileSync,rmSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
const phase=process.argv[2],projectId='atomic-ui-project',operationId='atomic-ui-operation';
const physicalAuthorityPort=Number(process.env.INTEGRATED_REACT_SIGKILL_PORT||53861);
const client=new MongoClient(process.env.MONGO_URI,{serverSelectionTimeoutMS:12000});await client.connect();
const db=client.db(['seed-pre','prekill','verify-pre'].includes(phase)?'isolated_integrated_react_kill_pre':'isolated_integrated_react_kill_post');
const projects=db.collection('projects'),receipts=db.collection('receipts');
let authority,serverOutput='';
async function startAuthority(mode){
 authority=spawn(process.execPath,['./verify-integrated-react-sigkill-server.mjs',mode],{stdio:['ignore','pipe','pipe'],env:process.env});
 authority.stdout.on('data',chunk=>{serverOutput+=chunk.toString();process.stdout.write(chunk)});
 authority.stderr.on('data',chunk=>process.stderr.write(chunk));
 for(let i=0;i<120;i++){if(serverOutput.includes('INTEGRATED_SERVER_LISTENING '+mode))return;if(authority.exitCode!==null)throw Error('authority-exited');await delay(100)}
 throw Error('authority-not-ready '+serverOutput);
}
async function killAt(marker){
 for(let i=0;i<200;i++){if(serverOutput.includes(marker))break;if(authority.exitCode!==null)throw Error('authority-exited-before-marker');await delay(50)}
 assert.ok(serverOutput.includes(marker),'missing kill marker '+marker+' '+serverOutput);
 authority.kill('SIGKILL');
 await new Promise((resolve,reject)=>{if(authority.exitCode!==null||authority.signalCode==='SIGKILL')return resolve();authority.once('exit',(_,signal)=>signal==='SIGKILL'?resolve():reject(Error('unexpected exit '+signal)))});
}

const files=['../frontend/src/components/studio/__atomic_ui_candidate.jsx','../frontend/__atomic_ui_candidate.jsx','../frontend/__atomic_ui_candidate.html','../frontend/__atomic_ui_vite.config.mjs'];
let vite,browser;
try{
 if(phase==='seed-pre'||phase==='seed-post'){
  await projects.deleteMany({});await receipts.deleteMany({});
  await receipts.createIndex({projectId:1,operationId:1},{unique:true});
  await receipts.createIndex({projectId:1,creatorTurnId:1},{unique:true});
  await projects.insertOne({_id:projectId,ownerId:'owner-1',revision:0,conversation:[]});
  console.log('GREEN ATOMIC_REACT_BROWSER_SEEDED');
 }else if(phase==='verify-pre'){
  const project=await projects.findOne({_id:projectId});
  assert.equal(project.revision,0);assert.deepEqual(project.conversation,[]);
  assert.equal(await receipts.countDocuments({projectId}),0);
  console.log('GREEN INTEGRATED_REACT_PRECOMMIT_SIGKILL_ROLLBACK');
 }else if(['prekill','postkill','recover'].includes(phase)){
  await startAuthority(phase==='recover'?'recover':phase);
  const source=readFileSync('../frontend/src/components/studio/CreatorWorkspace.jsx','utf8');
  const pattern=/const handleMovieMessage = \(message\) => \{([\s\S]*?)\n  \};/,match=source.match(pattern);
  assert.ok(match&&match[0].includes('recordPendingCreatorMessage')&&match[0].includes('settleConversationMessage'));
  const replacement='const handleMovieMessage=message=>{if(!activeMovieProject?.id)return;if(message.role==="creator"){if(globalThis.__atomicPending)throw Error("pending");globalThis.__atomicPending=message;setMovieMessages(m=>[...m,message]);return;}if(message.role!=="mentor")return;const creator=globalThis.__atomicPending;if(!creator||message.metadata?.backendMetadata?.creatorTurnId!==creator.id)throw Error("provenance");setMovieMessages(m=>[...m,message]);const input={projectId:"atomic-ui-project",operationId:"atomic-ui-operation",creatorTurnId:creator.id,expectedRevision:0,creatorMessage:creator,mentorMessage:message};const headers={authorization:"Bearer "+globalThis.__atomicToken,"content-type":"application/json"};void fetch("/conversation/settle",{method:"POST",headers,body:JSON.stringify(input)}).then(async r=>{if(!r.ok)throw Error("denied");const receipt=await r.json();if(receipt.creatorTurnId!==creator.id)throw Error("receipt");setProjectStatus("saved");}).catch(()=>setProjectStatus("error"));};';
  const initializer='const [activeMovieProject, setActiveMovieProject] = useState(resumeSnapshot?.project || null);';
  assert.ok(source.includes(initializer));
  let candidate=source.replace(match[0],replacement).replace(initializer,'const [activeMovieProject, setActiveMovieProject] = useState({id:"atomic-ui-project"});');
  const controls='<section aria-label="Atomic UI court"><button onClick={()=>handleMovieMessage({id:"atomic-ui-turn",role:"creator",text:"First movie scene"})}>Atomic creator</button><button onClick={()=>handleMovieMessage({id:"atomic-ui-mentor",role:"mentor",text:"Opening shot",metadata:{backendMetadata:{creatorTurnId:"atomic-ui-turn"}}})}>Atomic mentor</button><button onClick={()=>void(async()=>{const headers={authorization:"Bearer "+globalThis.__atomicToken,"content-type":"application/json"};const read=await fetch("/conversation/read",{method:"POST",headers,body:JSON.stringify({projectId:"atomic-ui-project"})});if(!read.ok)throw Error("read-denied");const snapshot=await read.json();const proof=await fetch("/conversation/receipt",{method:"POST",headers,body:JSON.stringify({projectId:"atomic-ui-project",operationId:"atomic-ui-operation"})});if(!proof.ok)throw Error("proof-denied");const receipt=await proof.json();if(receipt.committedRevision!==snapshot.revision||receipt.creatorTurnId!=="atomic-ui-turn"||snapshot.conversation.length!==2)throw Error("proof-mismatch");setMovieMessages(snapshot.conversation);globalThis.__atomicPending=null;setProjectStatus("saved");})().catch(()=>setProjectStatus("error"))}>Recover confirmed conversation</button><output aria-label="Atomic UI state">{projectStatus} | {movieMessages.map(m=>m.text).join(" / ")}</output></section>';
  assert.ok(candidate.includes('<main style={styles.workspace}>'));
  candidate=candidate.replace('<main style={styles.workspace}>','<main style={styles.workspace}>'+controls);
  assert.equal(candidate.includes(match[0]),false);
  writeFileSync(files[0],candidate);
  writeFileSync(files[1],'import React from "react";import {createRoot} from "react-dom/client";import CreatorWorkspace from "./src/components/studio/__atomic_ui_candidate.jsx";createRoot(document.getElementById("root")).render(<CreatorWorkspace creatorName="Diagnostic Creator"/>);');
  writeFileSync(files[2],'<html><body><div id="root"></div><script type="module" src="/__atomic_ui_candidate.jsx"></script></body></html>');
  writeFileSync(files[3],'import {defineConfig} from "vite";import react from "@vitejs/plugin-react-swc";export default defineConfig({plugins:[react()],server:{proxy:{"/conversation":{target:"http://127.0.0.1:'+physicalAuthorityPort+'",changeOrigin:true}}}});');
  vite=spawn('./node_modules/.bin/vite',['--host','127.0.0.1','--port','52759','--strictPort','--config','__atomic_ui_vite.config.mjs'],{cwd:'../frontend',stdio:['ignore','pipe','pipe']});
  let output='';vite.stdout.on('data',x=>output+=x);vite.stderr.on('data',x=>output+=x);
  let ready=false;
  for(let i=0;i<100;i++){if(vite.exitCode!==null)throw Error('vite-exit '+output.slice(-900));try{if((await fetch('http://127.0.0.1:52759/__atomic_ui_candidate.html')).ok){ready=true;break}}catch{}await delay(150)}
  assert.ok(ready,'vite-not-ready '+output.slice(-900));
  const {chromium}=await import('playwright');browser=await chromium.launch({headless:true});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.addInitScript(token=>{globalThis.__atomicToken=token;globalThis.__atomicPending=null},process.env.OWNER_TOKEN);
  await page.goto('http://127.0.0.1:52759/__atomic_ui_candidate.html');
  await page.getByRole('heading',{name:/Welcome back, Diagnostic Creator/}).waitFor({timeout:15000});
  const state=page.getByLabel('Atomic UI state');
  if(phase==='prekill'||phase==='postkill'){
   await page.getByRole('button',{name:'Atomic creator'}).click();
   await page.getByRole('button',{name:'Atomic mentor'}).click();
   await killAt(phase==='prekill'?'READY_TO_KILL_BEFORE_COMMIT':'READY_TO_KILL_AFTER_COMMIT');
   let shown='';
   for(let i=0;i<100;i++){shown=await state.textContent()||'';if(shown.startsWith('error | '))break;await delay(25)}
   assert.match(shown,/^error \| First movie scene \/ Opening shot$/);
   assert.equal(await page.evaluate(()=>globalThis.__atomicPending?.id),'atomic-ui-turn');
   const revision=(await projects.findOne({_id:projectId})).revision;
   assert.equal(revision,phase==='prekill'?0:1);
   assert.equal(await receipts.countDocuments({projectId}),phase==='prekill'?0:1);
   console.log('GREEN INTEGRATED_REACT_'+(phase==='prekill'?'PRECOMMIT':'POSTCOMMIT')+'_HTTP_SIGKILL_RETAINS_PENDING');
  }else{
   await page.getByRole('button',{name:'Recover confirmed conversation'}).click();
   let shown='';
   for(let i=0;i<100;i++){shown=await state.textContent()||'';if(shown.startsWith('saved | '))break;await delay(25)}
   assert.match(shown,/^saved \| First movie scene \/ Opening shot$/);
   assert.equal(await receipts.countDocuments({projectId}),1);
   assert.equal((await projects.findOne({_id:projectId})).conversation.length,2);
   console.log('GREEN ATOMIC_REACT_BROWSER_FRESH_PROCESS_CONFIRMED_TWO_MESSAGE_RECOVERY');
   const input={projectId,operationId,creatorTurnId:'atomic-ui-turn',expectedRevision:0,creatorMessage:{id:'atomic-ui-turn',role:'creator',text:'First movie scene'},mentorMessage:{id:'atomic-ui-mentor',role:'mentor',text:'Opening shot',metadata:{backendMetadata:{creatorTurnId:'atomic-ui-turn'}}}};
   const replay=await fetch('http://127.0.0.1:'+physicalAuthorityPort+'/conversation/settle',{method:'POST',headers:{authorization:'Bearer '+process.env.OWNER_TOKEN,'content-type':'application/json'},body:JSON.stringify(input)});
   assert.equal(replay.status,200);assert.equal((await replay.json()).committedRevision,1);
   assert.equal(await receipts.countDocuments({projectId}),1);
   console.log('GREEN ATOMIC_REACT_BROWSER_EXACTLY_ONCE_REPLAY');
  }
  assert.deepEqual(errors,[]);await page.close();
  console.log('HELD PRODUCTION_REACT_ATOMIC_WIRING_AND_ORIGINAL_FRONTEND_RED');
 }else throw Error('unknown phase '+phase);
}finally{
 if(browser)await browser.close();
 if(vite){vite.kill('SIGTERM');for(let i=0;i<30&&vite.exitCode===null;i++)await delay(100);if(vite.exitCode===null)vite.kill('SIGKILL')}
 for(const file of files)rmSync(file,{force:true});
 if(authority && authority.exitCode===null && authority.signalCode===null){authority.kill('SIGTERM');await new Promise(resolve=>authority.once('exit',resolve))}
 await client.close();
}
