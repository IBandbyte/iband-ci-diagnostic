import assert from 'node:assert/strict';
import {MongoClient} from 'mongodb';
import {createPublicKey} from 'node:crypto';
import {createWritableAdmissionGate} from './isolated-writable-admission-gate.mjs';
import {createServerOwnedEditor} from './isolated-server-owned-positive-editor.mjs';
import {createIsolatedCreatorHttpServer} from './isolated-creator-http-transport.mjs';
import {createBrowserCreatorHttpAdapter} from './isolated-browser-creator-http-adapter.mjs';
import {continueCreatorMemoryWithDurableAuthority} from './pinned-frontend-durable-creator-boundary.mjs';
const client=new MongoClient(process.env.MONGO_URI,{serverSelectionTimeoutMS:12000});await client.connect();
const projectId='frontend-boundary-compatibility',db=client.db('frontend_boundary_compatibility_court'),publicKey=createPublicKey(process.env.PUBLIC_KEY_PEM),gate=createWritableAdmissionGate({db,client,publicKey}),editor=createServerOwnedEditor({gate,db,client,publicKey});
const server=createIsolatedCreatorHttpServer({gate,editor,projectId,admissionOperationId:'admit1',afterCommitBeforeReply:({input})=>process.argv[2]==='socket'&&input.operationId==='admit1:socket'});
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+server.address().port;
 const request=async(path,token,body)=>{const r=await fetch(url+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()}};
 const owner=process.env.OWNER_TOKEN,intruder=process.env.INTRUDER_TOKEN,phase=process.argv[2];
 const canonical=await gate.states.findOne({projectId});assert.ok(canonical);
 const commit=(token,operationId,expectedRevision,proposedState)=>request('/creator/commit',token,{projectId,operationId,expectedRevision,proposedState});
 const read=(token,operationId)=>request('/creator/read-committed',token,{projectId,operationId});
 if(phase==='first'||phase==='second'){
  const second=phase==='second',operationId=second?'admit1:edit2':'admit1:edit1',expectedRevision=second?3:2,proposedState={...canonical.state,content:second?'creator-approved-scene-four':'creator-approved-scene-three'};
  const result=await commit(owner,operationId,expectedRevision,proposedState);assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.data.committedRevision,expectedRevision+1);
  const receipt=await read(owner,operationId);assert.equal(receipt.status,200);assert.deepEqual(receipt.data.state,proposedState);assert.equal(receipt.data.serverCommitId,result.data.serverCommitId);
  console.log(second?'GREEN HTTP_SECOND_EDIT_AND_AUTHENTICATED_READBACK':'GREEN HTTP_FIRST_EDIT_AND_AUTHENTICATED_READBACK');
 }else if(phase==='restart'){
  const state=canonical.state;
  for(const [id,revision,content] of [['admit1:edit1',3,'creator-approved-scene-three'],['admit1:edit2',4,'creator-approved-scene-four']]){
   const proposedState={...state,content};
   const result=await commit(owner,id,revision-1,proposedState);assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.data.committedRevision,revision);
   const receipt=await read(owner,id);assert.equal(receipt.status,200);assert.deepEqual(receipt.data.state,proposedState);
  }
  assert.equal((await gate.states.findOne({projectId})).revision,4);assert.equal(await editor.edits.countDocuments({projectId}),2);
  console.log('GREEN HTTP_FRESH_PROCESS_HISTORICAL_AND_LATEST_REPLAY');
  const forbidden=await read(intruder,'admit1:edit1');assert.notEqual(forbidden.status,200);
  const denied=await commit(intruder,'admit1:intruder',4,{...state,content:'intruder'});assert.notEqual(denied.status,200);
  const invalid=await commit('invalid','admit1:invalid',4,{...state,content:'invalid'});assert.equal(invalid.status,401);
  const mismatched=await commit(owner,'admit1:edit1',2,{...state,content:'tampered'});assert.notEqual(mismatched.status,200);
  console.log('GREEN HTTP_INTRUDER_INVALID_JWT_AND_TAMPER_DENIED');
 }else if(phase==='concurrent'){
  assert.equal(canonical.revision,4);
  const a={...canonical.state,content:'race-writer-a'},b={...canonical.state,content:'race-writer-b'};
  const results=await Promise.all([commit(owner,'admit1:raceA',4,a),commit(owner,'admit1:raceB',4,b)]);
  assert.equal(results.filter(r=>r.status===200).length,1,JSON.stringify(results));
  assert.equal(results.filter(r=>r.status!==200).length,1,JSON.stringify(results));
  const winner=results[0].status===200?'admit1:raceA':'admit1:raceB';
  const receipt=await read(owner,winner);assert.equal(receipt.status,200);
  assert.equal(receipt.data.committedRevision,5);
  assert.equal((await gate.states.findOne({projectId})).revision,5);
  assert.equal(await editor.edits.countDocuments({projectId}),3);
  console.log('GREEN HTTP_TWO_CONCURRENT_WRITERS_EXACTLY_ONE_WINNER');
 }else if(phase==='socket'){
  assert.equal(canonical.revision,5);
  const proposedState={...canonical.state,content:'durable-after-lost-http-response'};
  let interrupted=false;
  try{await commit(owner,'admit1:socket',5,proposedState)}catch{interrupted=true}
  assert.equal(interrupted,true,'HTTP response must be lost after durable commit');
  const stored=await gate.states.findOne({projectId});assert.equal(stored.revision,6);
  assert.equal(stored.state.content,proposedState.content);
  assert.equal(await editor.edits.countDocuments({projectId}),4);
  console.log('GREEN HTTP_POST_COMMIT_SOCKET_LOSS_DURABLE_EFFECT');
 }else if(phase==='socket-recover'){
  assert.equal(canonical.revision,6);
  const receipt=await read(owner,'admit1:socket');assert.equal(receipt.status,200,JSON.stringify(receipt));
  assert.equal(receipt.data.committedRevision,6);
  const original=await editor.edits.findOne({projectId,operationId:'admit1:socket'});
  assert.ok(original);
  const replay=await commit(owner,'admit1:socket',5,original.committedState);
  assert.equal(replay.status,200,JSON.stringify(replay));
  assert.equal(replay.data.serverCommitId,receipt.data.serverCommitId);
  assert.equal((await gate.states.findOne({projectId})).revision,6);
  assert.equal(await editor.edits.countDocuments({projectId}),4);
  console.log('GREEN HTTP_FRESH_PROCESS_SAME_OPERATION_REPLAY_NO_DUPLICATE');
 }else if(phase==='browser-physical'){
  assert.equal(canonical.revision,6);
  const {chromium}=await import('playwright');
  const {readFileSync}=await import('node:fs');
  const browser=await chromium.launch({headless:true});
  try{
   const page=await browser.newPage();
   await page.goto(url+'/creator/read-committed');
   const source=readFileSync('./isolated-browser-creator-http-adapter.mjs','utf8');
   const result=await page.evaluate(async({source,url,owner,canonical})=>{
    const moduleUrl='data:text/javascript;base64,'+btoa(source);
    const {createBrowserCreatorHttpAdapter}=await import(moduleUrl);
    const adapter=createBrowserCreatorHttpAdapter({baseUrl:url,getBearerToken:async()=>owner});
    const projectId='frontend-boundary-compatibility',operationId='admit1:browser',expectedRevision=6;
    const proposedState={...canonical.state,content:'physical-chromium-server-persisted-scene'};
    const receipt=await adapter.commit({projectId,operationId,expectedRevision,proposedState});
    const readback=await adapter.readCommitted({projectId,operationId});
    return {receipt,readback,proposedState};
   },{source,url,owner,canonical});
   assert.equal(result.receipt.committedRevision,7);
   assert.equal(result.readback.serverCommitId,result.receipt.serverCommitId);
   assert.deepEqual(result.readback.state,result.proposedState);
   await page.close();
   const fresh=await browser.newPage();
   await fresh.goto(url+'/creator/read-committed');
   const recovered=await fresh.evaluate(async({source,url,owner})=>{
    const {createBrowserCreatorHttpAdapter}=await import('data:text/javascript;base64,'+btoa(source));
    const adapter=createBrowserCreatorHttpAdapter({baseUrl:url,getBearerToken:async()=>owner});
    return adapter.readCommitted({projectId:'frontend-boundary-compatibility',operationId:'admit1:browser'});
   },{source,url,owner});
   assert.deepEqual(recovered.state,result.proposedState);
   assert.equal(recovered.serverCommitId,result.receipt.serverCommitId);
   assert.equal((await gate.states.findOne({projectId})).revision,7);
   assert.equal(await editor.edits.countDocuments({projectId}),5);
   console.log('GREEN PHYSICAL_CHROMIUM_AUTHENTICATED_HTTP_COMMIT_AND_READBACK');
   console.log('GREEN PHYSICAL_CHROMIUM_FRESH_PAGE_DURABLE_READBACK');
  }finally{await browser.close()}
 }else if(phase==='studio-browser-candidate'){
  assert.equal(canonical.revision,7,'candidate begins after physical browser seed');
  const {chromium}=await import('playwright');
  const {readFileSync}=await import('node:fs');
  const source=readFileSync('./pinned-creator-workspace.jsx','utf8');
  const original=source.match(/const handleMovieMessage = \(message\) => \{([\s\S]*?)\n  \};/);
  assert.ok(original,'exact pinned CreatorWorkspace handler required');
  assert.match(original[0],/recordPendingCreatorMessage/);
  assert.match(original[0],/settleConversationMessage/);
  // Source-derived Studio candidate: only the handler is replaced in memory; the
  // actual frontend bundle is neither rendered nor modified by this test.
  const candidate=`const handleMovieMessage = (message) => {
    if(message?.role === 'creator') {
      if(state.pending) throw Error('pending-turn-already-exists');
      state.pending=message;
      render('Pending: '+message.text);
      return;
    }
    if(message?.role !== 'mentor')return;
    if(!state.pending||message?.metadata?.backendMetadata?.creatorTurnId!==state.pending.id)throw Error('invalid-mentor-provenance');
    const creator=state.pending;
    void (async()=>{
      const proposedState={...baseState,content:JSON.stringify({creator,mentor:message})};
      const receipt=await transport.commit({projectId,operationId,expectedRevision:7,proposedState});
      const recovered=await transport.readCommitted({projectId,operationId});
      if(recovered.serverCommitId!==receipt.serverCommitId||recovered.committedRevision!==receipt.committedRevision)throw Error('readback-receipt-mismatch');
      const parsed=JSON.parse(recovered.state.content);
      if(parsed.creator.id!==creator.id||parsed.mentor.id!==message.id)throw Error('conversation-readback-mismatch');
      state.pending=null;state.confirmed=parsed;render('Confirmed: '+parsed.creator.text+' / '+parsed.mentor.text);
    })().catch(error=>{state.error=String(error);render('Pending: '+creator.text+' (server unknown)');});
  };`;
  assert.notEqual(source.replace(original[0],candidate),source);
  const moduleSource=readFileSync('./isolated-browser-creator-http-adapter.mjs','utf8');
  const browser=await chromium.launch({headless:true});
  const operationId='admit1:studio-browser',owner=process.env.OWNER_TOKEN;
  try{
    const page=await browser.newPage();
    await page.goto(url+'/creator/read-committed');
    await page.setContent('<main><h1>Isolated Studio candidate</h1><div id="conversation">Not confirmed</div></main>');
    const first=await page.evaluate(async({candidate,moduleSource,url,owner,projectId,operationId,baseState})=>{
      const {createBrowserCreatorHttpAdapter}=await import('data:text/javascript;base64,'+btoa(moduleSource));
      const transport=createBrowserCreatorHttpAdapter({baseUrl:url,getBearerToken:async()=>owner});
      const state={pending:null,confirmed:null,error:null};
      const render=text=>{document.querySelector('#conversation').textContent=text};
      const handler=new Function('state','render','transport','baseState','projectId','operationId',candidate+'\nreturn handleMovieMessage;')(state,render,transport,baseState,projectId,operationId);
      const creator={id:'studio-browser-turn',role:'creator',text:'An ocean scene'};
      const mentor={id:'studio-browser-mentor',role:'mentor',text:'Let us plan that scene',metadata:{backendMetadata:{creatorTurnId:creator.id}}};
      handler(creator);
      const before=document.querySelector('#conversation').textContent;
      handler(mentor);
      for(let i=0;i<100&&!state.confirmed&&!state.error;i++)await new Promise(resolve=>setTimeout(resolve,20));
      return {before,after:document.querySelector('#conversation').textContent,confirmed:state.confirmed,error:state.error};
    },{candidate,moduleSource,url,owner,projectId,operationId,baseState:canonical.state});
    assert.match(first.before,/Pending: An ocean scene/);
    assert.equal(first.error,null,JSON.stringify(first));
    assert.equal(first.confirmed?.creator?.text,'An ocean scene');
    assert.match(first.after,/Confirmed: An ocean scene/);
    assert.equal((await gate.states.findOne({projectId})).revision,8);
    console.log('GREEN SOURCE_DERIVED_STUDIO_CHROMIUM_AUTHENTICATED_CONVERSATION_SAVE_AND_READBACK');
    await page.close();
    const fresh=await browser.newPage();
    await fresh.goto(url+'/creator/read-committed');
    await fresh.setContent('<main><h1>Isolated Studio candidate reloaded</h1><div id="conversation">Not confirmed</div></main>');
    const recovered=await fresh.evaluate(async({moduleSource,url,owner,projectId,operationId})=>{
      const {createBrowserCreatorHttpAdapter}=await import('data:text/javascript;base64,'+btoa(moduleSource));
      const transport=createBrowserCreatorHttpAdapter({baseUrl:url,getBearerToken:async()=>owner});
      const receipt=await transport.readCommitted({projectId,operationId});
      const conversation=JSON.parse(receipt.state.content);
      document.querySelector('#conversation').textContent='Recovered: '+conversation.creator.text+' / '+conversation.mentor.text;
      return {conversation,text:document.querySelector('#conversation').textContent,receiptId:receipt.serverCommitId};
    },{moduleSource,url,owner,projectId,operationId});
    assert.equal(recovered.conversation.creator.id,'studio-browser-turn');
    assert.equal(recovered.conversation.mentor.id,'studio-browser-mentor');
    assert.match(recovered.text,/Recovered: An ocean scene/);
    assert.equal(await editor.edits.countDocuments({projectId}),6);
    console.log('GREEN SOURCE_DERIVED_STUDIO_CHROMIUM_FRESH_PAGE_DURABLE_CONVERSATION_RECOVERY');
    console.log('HELD REAL_CREATOR_WORKSPACE_REACT_MOUNT_AND_PROCESS_KILL_RECOVERY');
  }finally{await browser.close()}
 }else if(phase==='react-http-candidate'){
  assert.equal(canonical.revision,8);
  const {chromium}=await import('playwright');
  const {readFileSync,writeFileSync,rmSync}=await import('node:fs');
  const {spawn}=await import('node:child_process');
  const {setTimeout:delay}=await import('node:timers/promises');
  const root='../frontend',source=readFileSync(root+'/src/components/studio/CreatorWorkspace.jsx','utf8');
  const match=source.match(/const handleMovieMessage = \(message\) => \{([\s\S]*?)\n  \};/);
  assert.ok(match&&match[0].includes('recordPendingCreatorMessage')&&match[0].includes('settleConversationMessage'),'pinned local handler required');
  const replacement='const handleMovieMessage = (message) => { const projectId=activeMovieProject?.id; if(!projectId)return; if(message?.role==="creator"){ if(globalThis.__studioPending)throw Error("pending-turn-conflict");globalThis.__studioPending=message;setMovieMessages(a=>[...a,message]);return;} if(message?.role!=="mentor")return;const creator=globalThis.__studioPending;if(!creator||message.metadata?.backendMetadata?.creatorTurnId!==creator.id)throw Error("mentor-provenance-denied");setMovieMessages(a=>[...a,message]);const proposedState={...globalThis.__studioBaseState,content:JSON.stringify({creator,mentor:message})};void (async()=>{ const body={projectId,operationId:"admit1:react-http",expectedRevision:8,proposedState};const headers={"content-type":"application/json",authorization:"Bearer "+globalThis.__studioToken};const resp=await fetch("/creator/commit",{method:"POST",headers,body:JSON.stringify(body)});if(!resp.ok)throw Error("commit-unknown");const receipt=await resp.json();const read=await fetch("/creator/read-committed",{method:"POST",headers,body:JSON.stringify({projectId,operationId:body.operationId})});if(!read.ok)throw Error("readback-denied");const recovered=await read.json();if(receipt.serverCommitId!==recovered.serverCommitId||receipt.committedRevision!==recovered.committedRevision)throw Error("receipt-mismatch");const conversation=JSON.parse(recovered.state.content);if(conversation.creator.id!==creator.id||conversation.mentor.id!==message.id)throw Error("conversation-mismatch");globalThis.__studioPending=null;setMovieMessages([conversation.creator,conversation.mentor]);setProjectStatus("saved");})().catch(()=>setProjectStatus("error")); };';
  const initial='const [activeMovieProject, setActiveMovieProject] = useState(resumeSnapshot?.project || null);';
  assert.ok(source.includes(initial));
  let candidate=source.replace(match[0],replacement).replace(initial,'const [activeMovieProject, setActiveMovieProject] = useState({id:"frontend-boundary-compatibility"});');
  const controls='<section aria-label="React HTTP Studio candidate"><button onClick={()=>handleMovieMessage({id:"http-creator-1",role:"creator",text:"Shoreline project"})}>Send diagnostic creator turn</button><button onClick={()=>handleMovieMessage({id:"http-mentor-1",role:"mentor",text:"Plan the coastline",metadata:{backendMetadata:{creatorTurnId:"http-creator-1"}}})}>Send diagnostic mentor reply</button><output aria-label="React HTTP conversation status">{projectStatus} | {movieMessages.map(x=>x.text).join(" / ")}</output></section>';
  assert.ok(candidate.includes('<main style={styles.workspace}>'));
  candidate=candidate.replace('<main style={styles.workspace}>','<main style={styles.workspace}>'+controls);
  assert.equal(candidate.includes(match[0]),false);
  const comp=root+'/src/components/studio/__diagnostic_http_react.jsx',html=root+'/__diagnostic_http_react.html',entry=root+'/__diagnostic_http_react.jsx',config=root+'/__diagnostic_http_vite.config.mjs';
  const proxyPort=52743;
  writeFileSync(comp,candidate);
  writeFileSync(html,'<html><body><div id="root"></div><script type="module" src="/__diagnostic_http_react.jsx"></script></body></html>');
  writeFileSync(entry,'import React from "react"; import {createRoot} from "react-dom/client"; import CreatorWorkspace from "./src/components/studio/__diagnostic_http_react.jsx"; createRoot(document.getElementById("root")).render(<CreatorWorkspace creatorName="Diagnostic Creator"/>);');
  writeFileSync(config,'import {defineConfig} from "vite"; export default defineConfig({server:{proxy:{"/creator":{target:"http://127.0.0.1:'+server.address().port+'",changeOrigin:true}}}});');
  const vite=spawn('./node_modules/.bin/vite',['--host','127.0.0.1','--port',String(proxyPort),'--strictPort','--config','__diagnostic_http_vite.config.mjs'],{cwd:root,stdio:['ignore','pipe','pipe']});
  let output='';vite.stdout.on('data',x=>output+=x);vite.stderr.on('data',x=>output+=x);
  let browser;
  try{
    let ready=false;for(let i=0;i<100;i++){if(vite.exitCode!==null)throw Error('Vite exit '+output.slice(-1000));try{if((await fetch('http://127.0.0.1:'+proxyPort+'/__diagnostic_http_react.html')).ok){ready=true;break}}catch{}await delay(150)}
    assert.ok(ready,'Vite not ready '+output.slice(-900));
    browser=await chromium.launch({headless:true});
    const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
    await page.addInitScript(({token,baseState})=>{globalThis.__studioToken=token;globalThis.__studioBaseState=baseState;globalThis.__studioPending=null},{token:process.env.OWNER_TOKEN,baseState:canonical.state});
    await page.goto('http://127.0.0.1:'+proxyPort+'/__diagnostic_http_react.html');
    await page.getByRole('heading',{name:/Welcome back, Diagnostic Creator/}).waitFor({timeout:15000});
    await page.getByRole('button',{name:'Send diagnostic creator turn'}).click();
    await page.getByRole('button',{name:'Send diagnostic mentor reply'}).click();
    const outputNode=page.getByLabel('React HTTP conversation status');let shown='';
    for(let i=0;i<100;i++){shown=await outputNode.textContent()||'';if(shown.startsWith('saved | '))break;await delay(25)}
    assert.match(shown,/^saved \| Shoreline project \/ Plan the coastline$/);
    assert.equal(await page.evaluate(()=>globalThis.__studioPending),null);
    assert.deepEqual(errors,[]);
    const stored=await gate.states.findOne({projectId});
    assert.equal(stored.revision,9);
    const committed=JSON.parse(stored.state.content);
    assert.equal(committed.creator.id,'http-creator-1');
    assert.equal(committed.mentor.id,'http-mentor-1');
    console.log('GREEN PINNED_REACT_CANDIDATE_AUTHENTICATED_HTTP_MONGO_CONVERSATION_READBACK');
    await page.close();
    const fresh=await browser.newPage();await fresh.goto('http://127.0.0.1:'+proxyPort+'/__diagnostic_http_react.html');
    const recovered=await fresh.evaluate(async(token)=>{
      const response=await fetch('/creator/read-committed',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({projectId:'frontend-boundary-compatibility',operationId:'admit1:react-http'})});
      if(!response.ok)throw Error('recovery-denied');
      return response.json();
    },process.env.OWNER_TOKEN);
    assert.equal(recovered.committedRevision,9);
    assert.deepEqual(JSON.parse(recovered.state.content),committed);
    assert.equal(await editor.edits.countDocuments({projectId}),7);
    console.log('GREEN PINNED_REACT_CANDIDATE_FRESH_PAGE_AUTHENTICATED_CONVERSATION_RECOVERY');
    console.log('HELD ATOMIC_TWO_MESSAGE_STUDIO_SETTLEMENT_AND_PRODUCTION_REACT_WIRING');
  }finally{
    if(browser)await browser.close();
    vite.kill('SIGTERM');for(let i=0;i<30&&vite.exitCode===null;i++)await delay(100);if(vite.exitCode===null)vite.kill('SIGKILL');
    for(const file of [comp,html,entry,config])rmSync(file,{force:true});
  }
 }else if(phase==='revoke'){
  assert.equal(canonical.revision,9);await gate.states.updateOne({_id:canonical._id,revoked:false},{$set:{revoked:true}});
  assert.notEqual((await read(owner,'admit1:edit1')).status,200);
  assert.notEqual((await read(owner,'admit1:edit2')).status,200);
  assert.notEqual((await commit(owner,'admit1:edit3',4,{...canonical.state,content:'forbidden'})).status,200);
  assert.equal((await gate.states.findOne({projectId})).revision,9);assert.equal(await editor.edits.countDocuments({projectId}),7);
  console.log('GREEN HTTP_REVOKED_OWNER_READ_AND_EDIT_DENIED');
  console.log('HELD ORIGINAL_FRONTEND_RED_AND_REAL_UI_INTEGRATION');
 }else throw Error('unknown phase');
}finally{await new Promise(resolve=>server.close(resolve));await client.close()}
