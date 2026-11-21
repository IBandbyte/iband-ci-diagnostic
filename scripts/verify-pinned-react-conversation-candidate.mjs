// Test-only copy of real pinned React CreatorWorkspace with controlled authority.
// This does not certify authenticated HTTP/Mongo or the unmodified React handler.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,rmSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
const root='frontend',component=root+'/src/components/studio/__diagnostic_react_candidate.jsx',html=root+'/__diagnostic_react_candidate.html',entry=root+'/__diagnostic_react_candidate.jsx';
const original=readFileSync(root+'/src/components/studio/CreatorWorkspace.jsx','utf8');
const pattern=/const handleMovieMessage = \(message\) => \{([\s\S]*?)\n  \};/;
const existing=original.match(pattern);
assert.ok(existing,'pinned real handler required');
assert.match(existing[0],/recordPendingCreatorMessage/);
assert.match(existing[0],/settleConversationMessage/);
const replacement='const handleMovieMessage = (message) => { const authority=globalThis.__candidateAuthority; if (!activeMovieProject?.id || !authority) return; if(message.role==="creator"){ authority.creator(message); setMovieMessages(m=>[...m,message]); return; } if(message.role!=="mentor")return; authority.mentor(message); setMovieMessages(m=>[...m,message]); void authority.confirm().then(async result=>{if(!result.durable){setProjectStatus("error");return;} const recovered=await authority.restore(); if(recovered.published){setMovieMessages(recovered.conversation);setProjectStatus("saved");}else setProjectStatus("error");}).catch(()=>setProjectStatus("error")); };';
let patched=original.replace(existing[0],replacement);
const initializer='const [activeMovieProject, setActiveMovieProject] = useState(resumeSnapshot?.project || null);';
assert.ok(patched.includes(initializer));
patched=patched.replace(initializer,'const [activeMovieProject, setActiveMovieProject] = useState({id:"diagnostic-react-project"});');
const injected='<section aria-label="Diagnostic React conversation"><button onClick={()=>handleMovieMessage({id:"creator-1",role:"creator",text:"Ocean scene"})}>Creator test turn</button><button onClick={()=>handleMovieMessage({id:"mentor-1",role:"mentor",text:"Shoreline reply",metadata:{backendMetadata:{creatorTurnId:"creator-1"}}})}>Mentor test reply</button><output aria-label="Diagnostic React status">{projectStatus} | {movieMessages.map(m=>m.text).join(" / ")}</output></section>';
assert.ok(patched.includes('<main style={styles.workspace}>'));
patched=patched.replace('<main style={styles.workspace}>','<main style={styles.workspace}>'+injected);
assert.doesNotMatch(patched.match(pattern)[0],/recordPendingCreatorMessage|settleConversationMessage/);
writeFileSync(component,patched);
writeFileSync(html,'<html><body><div id="root"></div><script type="module" src="/__diagnostic_react_candidate.jsx"></script></body></html>');
writeFileSync(entry,'import React from "react"; import {createRoot} from "react-dom/client"; import CreatorWorkspace from "./src/components/studio/__diagnostic_react_candidate.jsx"; createRoot(document.getElementById("root")).render(<CreatorWorkspace creatorName="Diagnostic Creator"/>);');
const port=52732,url='http://127.0.0.1:'+port;
const vite=spawn('./node_modules/.bin/vite',['--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:root,stdio:['ignore','pipe','pipe']});
let output='';vite.stdout.on('data',x=>output+=x);vite.stderr.on('data',x=>output+=x);
let browser;
try {
 let ready=false;
 for(let n=0;n<100;n++){if(vite.exitCode!==null)throw Error('Vite exited: '+output.slice(-1000));try{if((await fetch(url+'/__diagnostic_react_candidate.html')).ok){ready=true;break}}catch{}await delay(200)}
 assert.ok(ready,'Vite not ready: '+output.slice(-1000));
 const {chromium}=await import('../backend/node_modules/playwright/index.mjs');
 browser=await chromium.launch({headless:true});
 for(const mode of ['unknown','confirmed']){
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  await page.addInitScript(({mode})=>{const state={creator:null,mentor:null,pending:false};globalThis.__candidateAuthority={
   creator(m){if(state.pending)throw Error('pending conflict');state.creator=m;state.pending=true},
   mentor(m){if(!state.pending||m.metadata?.backendMetadata?.creatorTurnId!==state.creator.id)throw Error('provenance denied');state.mentor=m},
   async confirm(){return {durable:mode==='confirmed'}},
   async restore(){if(mode!=='confirmed')throw Error('unknown recovery');state.pending=false;return {published:true,conversation:[state.creator,state.mentor]}},
   hasPending(){return state.pending}
  }},{mode});
  await page.goto(url+'/__diagnostic_react_candidate.html');
  await page.getByRole('heading',{name:/Welcome back, Diagnostic Creator/}).waitFor({timeout:15000});
  await page.getByRole('button',{name:'Creator test turn'}).click();
  await page.getByRole('button',{name:'Mentor test reply'}).click();
  const output=page.getByLabel('Diagnostic React status');
  const required=mode==='unknown'?'error | ':'saved | ';
  let observed='';
  for(let n=0;n<100;n++){observed=await output.textContent()||'';if(observed.startsWith(required))break;await delay(20)}
  assert.ok(observed.startsWith(required),mode+' expected '+required+' got '+observed);
  assert.match(observed,/Ocean scene \/ Shoreline reply/);
  assert.equal(await page.evaluate(()=>globalThis.__candidateAuthority.hasPending()),mode==='unknown');
  assert.deepEqual(errors,[],'uncaught '+mode+' errors');
  console.log(mode==='unknown'?'GREEN PINNED_REACT_CANDIDATE_UNKNOWN_RETAINS_PENDING':'GREEN PINNED_REACT_CANDIDATE_CONFIRMED_PUBLISHES_CONVERSATION');
  await page.close();
 }
 console.log('HELD REAL_REACT_AUTHENTICATED_CONVERSATION_HTTP_MONGO_WIRING_AND_ORIGINAL_RED');
}finally{
 if(browser)await browser.close();
 vite.kill('SIGTERM');
 for(let n=0;n<30&&vite.exitCode===null;n++)await delay(100);
 if(vite.exitCode===null)vite.kill('SIGKILL');
 for(const path of [component,html,entry])rmSync(path,{force:true});
}
