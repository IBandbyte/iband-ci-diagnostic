// Isolated real React component mount, not a server-authority integration certification.
// Called from repository root after exact-pinned frontend + Chromium dependencies are installed.
import assert from 'node:assert/strict';
import {writeFileSync,rmSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

const root='frontend',html=root+'/__diagnostic_creator_mount.html',entry=root+'/__diagnostic_creator_mount.jsx';
const port=52731,origin='http://127.0.0.1:'+port;
const htmlSource='<html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/__diagnostic_creator_mount.jsx"></script></body></html>';
const entrySource=`import React from 'react';
import {createRoot} from 'react-dom/client';
import CreatorWorkspace from './src/components/studio/CreatorWorkspace.jsx';
createRoot(document.getElementById('root')).render(<CreatorWorkspace creatorName="Diagnostic Creator" />);
`;
writeFileSync(html,htmlSource);writeFileSync(entry,entrySource);
const vite=spawn('./node_modules/.bin/vite',['--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:root,stdio:['ignore','pipe','pipe']});
let output='';
vite.stdout.on('data',b=>{output+=b.toString()});
vite.stderr.on('data',b=>{output+=b.toString()});
let browser;
try{
 let ready=false;
 for(let n=0;n<100;n++){
  if(vite.exitCode!==null)throw Error('vite-exited-before-ready '+output.slice(-1500));
  try{const r=await fetch(origin+'/__diagnostic_creator_mount.html');if(r.ok){ready=true;break}}catch{}
  await delay(200);
 }
 assert.ok(ready,'isolated Vite mount server not ready '+output.slice(-1500));
 const {chromium}=await import('../backend/node_modules/playwright/index.mjs');
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage();
 const pageErrors=[];page.on('pageerror',e=>pageErrors.push(String(e)));
 await page.goto(origin+'/__diagnostic_creator_mount.html');
 await page.getByRole('heading',{name:/Welcome back, Diagnostic Creator/}).waitFor({timeout:15000});
 assert.equal(await page.getByRole('heading',{name:/Recover an existing movie/}).count(),1);
 assert.equal(await page.getByRole('button',{name:'Recover movie preview'}).count(),1);
 assert.deepEqual(pageErrors,[],'real pinned component must mount without uncaught error');
 console.log('GREEN PINNED_REAL_REACT_CREATOR_WORKSPACE_CHROMIUM_MOUNT');
 const source=await (await import('node:fs/promises')).readFile(root+'/src/components/studio/CreatorWorkspace.jsx','utf8');
 assert.match(source,/identityRuntime\\s*\\.settleConversationMessage/);
 assert.match(source,/identityRuntime\\.recordPendingCreatorMessage/);
 console.log('GREEN REAL_REACT_STUDIO_LEGACY_CONVERSATION_CALLS_IDENTIFIED');
 console.log('HELD REAL_REACT_STUDIO_AUTHENTICATED_CONVERSATION_WIRING_AND_ORIGINAL_FRONTEND_RED');
 await page.close();
}finally{
 if(browser)await browser.close();
 vite.kill('SIGTERM');
 for(let n=0;n<30&&vite.exitCode===null;n++)await delay(100);
 if(vite.exitCode===null)vite.kill('SIGKILL');
 rmSync(html,{force:true});rmSync(entry,{force:true});
}
