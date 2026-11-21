// Physical Chromium/Mongo court for the exact pinned full-file migrated CreatorWorkspace handler.
// Diagnostic copy only. No application main branch edits and no release certification.
import assert from 'node:assert/strict';
import {MongoClient} from 'mongodb';
import {createPublicKey} from 'node:crypto';
import {readFileSync,writeFileSync,rmSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {createIsolatedConversationHttpAuthority} from './isolated-conversation-http-authority.mjs';
import {transformPinnedCreatorWorkspace} from './isolated-real-react-handler-migration-candidate.mjs';

const phase=process.argv[2],projectId='migrated-physical-film',turnId='migrated-physical-turn';
assert.ok(['seed','positive','unknown','recover'].includes(phase));
const operationId='studio-'+turnId;
const client=new MongoClient(process.env.MONGO_URI,{serverSelectionTimeoutMS:12000});
await client.connect();
const db=client.db('isolated_migrated_real_handler_physical');
const {server,projects,receipts}=createIsolatedConversationHttpAuthority({
 db,client,publicKey:createPublicKey(process.env.PUBLIC_KEY_PEM),
 dropAfterCommitOperationId:phase==='unknown'?operationId:null
});
const files=[
 '../frontend/src/components/studio/__migrated_real_handler_candidate.jsx',
 '../frontend/__migrated_real_handler_entry.jsx',
 '../frontend/__migrated_real_handler.html',
 '../frontend/__migrated_real_handler_vite.config.mjs',
 '../frontend/__migrated_real_handler_authority.mjs'
];
let vite,browser;
const creator={id:turnId,role:'creator',text:'First physical film scene'};
const mentor={id:'migrated-mentor',role:'mentor',text:'Opening wide shot',metadata:{backendMetadata:{creatorTurnId:turnId}}};
try{
 if(phase==='seed'){
  await projects.deleteMany({});await receipts.deleteMany({});
  await receipts.createIndex({projectId:1,operationId:1},{unique:true});
  await receipts.createIndex({projectId:1,creatorTurnId:1},{unique:true});
  await projects.insertOne({_id:projectId,ownerId:'owner-1',revision:0,conversation:[]});
  console.log('GREEN MIGRATED_REAL_HANDLER_PHYSICAL_MONGO_SEEDED');
 }else{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const source=readFileSync('../frontend/src/components/studio/CreatorWorkspace.jsx','utf8');
  let candidate=transformPinnedCreatorWorkspace(source);
  const initializer='const [activeMovieProject, setActiveMovieProject] = useState(resumeSnapshot?.project || null);';
  assert.ok(candidate.includes(initializer),'pinned project initializer');
  candidate=candidate.replace(initializer,'const [activeMovieProject, setActiveMovieProject] = useState({id:"migrated-physical-film"});');
  const controls='<section aria-label="Migrated handler physical court"><button onClick={()=>handleMovieMessage({id:"migrated-physical-turn",role:"creator",text:"First physical film scene"})}>Physical creator</button><button onClick={()=>handleMovieMessage({id:"migrated-mentor",role:"mentor",text:"Opening wide shot",metadata:{backendMetadata:{creatorTurnId:"migrated-physical-turn"}}})}>Physical mentor</button><button onClick={()=>void(async()=>{const a=globalThis.__diagnosticConversationAuthority;const recovered=await a.readConfirmed("migrated-physical-film");const receiptResponse=await fetch("/conversation/receipt",{method:"POST",headers:{authorization:"Bearer "+globalThis.__diagnosticToken,"content-type":"application/json"},body:JSON.stringify({projectId:"migrated-physical-film",operationId:"studio-migrated-physical-turn"})});if(!receiptResponse.ok)throw Error("receipt-denied");const receipt=await receiptResponse.json();if(receipt.committedRevision!==recovered.revision||receipt.creatorTurnId!=="migrated-physical-turn"||recovered.conversation.length!==2)throw Error("readback-denied");setMovieMessages(recovered.conversation);setProjectStatus("saved");})().catch(()=>setProjectStatus("error"))}>Read confirmed after restart</button><output aria-label="Migrated physical status">{projectStatus} | {movieMessages.map(m=>m.text).join(" / ")}</output></section>';
  assert.ok(candidate.includes('<main style={styles.workspace}>'));
  candidate=candidate.replace('<main style={styles.workspace}>','<main style={styles.workspace}>'+controls);
  writeFileSync(files[0],candidate);
  // Browser-side runtime is sliced from the SAME tested migration adapter source, not a mock.
  const helper=readFileSync('./isolated-real-react-handler-migration-candidate.mjs','utf8');
  const runtime=helper.slice(helper.indexOf('export function createDiagnosticHttpConversationAuthority'));
  assert.ok(runtime.startsWith('export function createDiagnosticHttpConversationAuthority'));
  writeFileSync(files[4],runtime);
  writeFileSync(files[1],'import React from "react";import {createRoot} from "react-dom/client";import CreatorWorkspace from "./src/components/studio/__migrated_real_handler_candidate.jsx";import {createDiagnosticHttpConversationAuthority} from "./__migrated_real_handler_authority.mjs";const request=async(path,options)=>{const response=await fetch(path,options);return {status:response.status,data:await response.json()}};globalThis.__diagnosticConversationAuthority=createDiagnosticHttpConversationAuthority({request,token:globalThis.__diagnosticToken});createRoot(document.getElementById("root")).render(<CreatorWorkspace creatorName="Diagnostic Creator"/>);');
  writeFileSync(files[2],'<html><body><div id="root"></div><script type="module" src="/__migrated_real_handler_entry.jsx"></script></body></html>');
  writeFileSync(files[3],'import {defineConfig} from "vite";import react from "@vitejs/plugin-react-swc";export default defineConfig({plugins:[react()],server:{proxy:{"/conversation":{target:"http://127.0.0.1:'+server.address().port+'",changeOrigin:true}}}});');
  vite=spawn('./node_modules/.bin/vite',['--host','127.0.0.1','--port','52765','--strictPort','--config','__migrated_real_handler_vite.config.mjs'],{cwd:'../frontend',stdio:['ignore','pipe','pipe']});
  let logs='';vite.stdout.on('data',c=>logs+=c);vite.stderr.on('data',c=>logs+=c);
  let ready=false;
  for(let i=0;i<100;i++){if(vite.exitCode!==null)throw Error('vite-exit '+logs.slice(-1000));try{if((await fetch('http://127.0.0.1:52765/__migrated_real_handler.html')).ok){ready=true;break}}catch{}await delay(150)}
  assert.ok(ready,'vite-not-ready '+logs.slice(-1000));
  const {chromium}=await import('playwright');browser=await chromium.launch({headless:true});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.addInitScript(token=>{globalThis.__diagnosticToken=token},process.env.OWNER_TOKEN);
  await page.goto('http://127.0.0.1:52765/__migrated_real_handler.html');
  await page.getByRole('heading',{name:/Welcome back, Diagnostic Creator/}).waitFor({timeout:15000});
  const state=page.getByLabel('Migrated physical status');
  if(phase==='positive'||phase==='unknown'){
   await page.getByRole('button',{name:'Physical creator'}).click();
   await page.getByRole('button',{name:'Physical mentor'}).click();
   const expected=phase==='positive'?'saved | ':'error | ';
   let observed='';
   for(let i=0;i<150;i++){observed=await state.textContent()||'';if(observed.startsWith(expected))break;await delay(30)}
   assert.equal(observed,expected+(phase==='positive'?'First physical film scene / Opening wide shot':'First physical film scene'));
   const pending=await page.evaluate(()=>globalThis.__diagnosticConversationAuthority.getPending('migrated-physical-film')?.id||null);
   assert.equal(pending,phase==='positive'?null:turnId);
   const doc=await projects.findOne({_id:projectId});
   assert.equal(doc.revision,1);
   assert.deepEqual(doc.conversation,[creator,mentor]);
   assert.equal(await receipts.countDocuments({projectId}),1);
   console.log(phase==='positive'?'GREEN MIGRATED_REAL_HANDLER_PHYSICAL_CHROMIUM_HTTP_MONGO_CONFIRMED':'GREEN MIGRATED_REAL_HANDLER_PHYSICAL_HTTP_LOST_RESPONSE_RETAINS_PENDING');
  }else{
   await page.getByRole('button',{name:'Read confirmed after restart'}).click();
   let observed='';
   for(let i=0;i<150;i++){observed=await state.textContent()||'';if(observed.startsWith('saved | '))break;await delay(30)}
   assert.equal(observed,'saved | First physical film scene / Opening wide shot');
   assert.equal(await receipts.countDocuments({projectId}),1);
   console.log('GREEN MIGRATED_REAL_HANDLER_PHYSICAL_FRESH_BROWSER_SERVER_READBACK');
  }
  const intruder=await fetch('http://127.0.0.1:'+server.address().port+'/conversation/read',{method:'POST',headers:{authorization:'Bearer '+process.env.INTRUDER_TOKEN,'content-type':'application/json'},body:JSON.stringify({projectId})});
  assert.equal(intruder.status,403);
  console.log('GREEN MIGRATED_REAL_HANDLER_PHYSICAL_INTRUDER_READ_DENIED');
  assert.deepEqual(errors,[]);
  await page.close();
  console.log('HELD ORIGINAL_FRONTEND_RED_AND_PRODUCTION_APP_HANDLER');
 }
}finally{
 if(browser)await browser.close();
 if(vite){vite.kill('SIGTERM');for(let i=0;i<30&&vite.exitCode===null;i++)await delay(100);if(vite.exitCode===null)vite.kill('SIGKILL')}
 for(const file of files)rmSync(file,{force:true});
 if(server.listening)await new Promise(resolve=>server.close(resolve));
 await client.close();
}
