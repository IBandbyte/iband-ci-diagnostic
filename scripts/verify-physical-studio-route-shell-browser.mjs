// Physical React Router examination of pinned Studio route shell candidate.
// Runs in an isolated Chromium browser, with controlled test auth and a
// tiny read-only workspace to observe whether the shell actually mounts.
// Previously-certified native React/Mongo courts remain separate.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {transformPinnedStudioRouteToAuthorityShell} from './isolated-pinned-studio-route-authority-candidate.mjs';
const base='__physical_studio_route_authority_shell';
const root='../frontend';
const files=[
 root+'/src/'+base+'_App.jsx',
 root+'/src/'+base+'_entry.jsx',
 root+'/src/'+base+'_Workspace.jsx',
 root+'/src/components/studio/mentor/StudioRouteAuthorityShell.jsx',
 root+'/src/components/studio/mentor/MovieMentorStudioRouteLifecycle.mjs',
 root+'/'+base+'.html',
 root+'/'+base+'_vite.config.mjs'
];
let vite,browser,page,logs='';
const errors=[],browserDiagnostics=[];
try{
 const pinned=readFileSync(root+'/src/App.jsx','utf8');
 const regression=readFileSync(root+'/scripts/verify-movie-mentor-conversation-continuity.mjs','utf8');
 assert.match(regression,/assert\.equal\(cleared\.acquired, true\)/);
 let app=transformPinnedStudioRouteToAuthorityShell(pinned);
 const anchor='import StudioRouteAuthorityShell from "./components/studio/mentor/StudioRouteAuthorityShell.jsx";';
 assert.equal(app.split(anchor).length,2);
 app=app.replace(anchor,anchor+'\nimport TestReadOnlyWorkspace from "./'+base+'_Workspace.jsx";\nimport {createPhysicalSession} from "./'+base+'_entry.jsx";');
 const route='element={<StudioRouteAuthorityShell onGenerate={generateMovieMentorLiveResponse} />}';
 assert.equal(app.split(route).length,2);
 app=app.replace(route,'element={<StudioRouteAuthorityShell onGenerate={generateMovieMentorLiveResponse} createSession={createPhysicalSession} WorkspaceComponent={TestReadOnlyWorkspace} />}');
 writeFileSync(files[0],app);
 writeFileSync(files[2],`import React from 'react';export default function TestReadOnlyWorkspace({applicationSecondFilm,studioServices,studioRecoveryServices}){if(!applicationSecondFilm||!studioServices?.request||!studioRecoveryServices)return <p data-testid="invalid-authority">INVALID</p>;return <div data-testid="verified-studio">AUTHENTICATED STUDIO READY</div>}`);
 writeFileSync(files[3],readFileSync('./isolated-studio-route-authority-react-shell.jsx','utf8'));
 writeFileSync(files[4],readFileSync('./isolated-studio-authority-route-lifecycle.mjs','utf8'));
 writeFileSync(files[1],`import React from 'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router-dom';import App from './${base}_App.jsx';import{setMovieMentorCreatorAuthState,clearMovieMentorCreatorAuthState}from'./components/studio/mentor/MovieMentorCreatorAuthenticationTransport.js';
let release=null;let generations=0;globalThis.__physicalRouteDebug={getGenerations:()=>generations};globalThis.__physicalRouteAuth=(kind)=>{if(kind==='signout')return clearMovieMentorCreatorAuthState();if(kind==='delayed'){let resolve;const promise=new Promise(r=>resolve=r);release=resolve;setMovieMentorCreatorAuthState({isLoaded:true,isSignedIn:true,getToken:()=>promise});return;}setMovieMentorCreatorAuthState({isLoaded:true,isSignedIn:true,getToken:async()=>kind==='second'?'token-2':'token-1'});};
globalThis.__physicalReleaseDelayed=()=>{release?.('stale-token');release=null};
export function createPhysicalSession({getAuthToken}){generations++;let invalidated=false,services=null;return{invalidate(){invalidated=true;services=null},getServices(){return invalidated?null:services},async open(){const token=await getAuthToken();if(invalidated||typeof token!=='string'||!token.startsWith('token-'))return{ok:false};services={applicationSecondFilm:{getReadOnly:()=>null},studioServices:{editable:{},selection:{},request:async()=>{if(invalidated)throw Error('invalidated')}},recoveryServices:()=>({continuity:{},token,selectionVaultId:'vault'})};return{ok:true,services}}}};
history.replaceState({},'', '/studio');
createRoot(document.getElementById('root')).render(<BrowserRouter><App/></BrowserRouter>);`);
 writeFileSync(files[5],`<html><body><div id="root"></div><script type="module" src="/src/${base}_entry.jsx"></script></body></html>`);
 writeFileSync(files[6],`import{defineConfig}from'vite';import react from'@vitejs/plugin-react-swc';export default defineConfig({plugins:[react()]});`);
 const port=52819;
 vite=spawn('./node_modules/.bin/vite',['--host','127.0.0.1','--port',String(port),'--strictPort','--config',base+'_vite.config.mjs'],{cwd:root,stdio:['ignore','pipe','pipe']});
 logs='';vite.stderr.on('data',x=>logs+=x);vite.stdout.on('data',x=>logs+=x);
 let ready=false;
 for(let i=0;i<90;i++){if(vite.exitCode!==null)throw Error('vite-exited '+logs.slice(-1800));try{if((await fetch('http://127.0.0.1:'+port+'/'+base+'.html')).ok){ready=true;break}}catch{}await delay(150)}
 assert.ok(ready,'Vite route shell not ready: '+logs.slice(-1500));
 const {chromium}=await import('playwright');
 browser=await chromium.launch({headless:true});
 page=await browser.newPage();page.on('pageerror',e=>errors.push(String(e)));
 page.on('console',m=>{if(m.type()==='error')browserDiagnostics.push(m.text())});
 page.on('requestfailed',r=>browserDiagnostics.push(r.url()+' '+r.failure()?.errorText));
 await page.goto('http://127.0.0.1:'+port+'/'+base+'.html');
 await page.getByRole('status',{name:'Studio authority locked'}).waitFor({timeout:15000});
 assert.equal(await page.getByTestId('verified-studio').count(),0);
 console.log('GREEN PHYSICAL_STUDIO_ROUTE_LOCKED_BEFORE_AUTH');
 await page.evaluate(()=>globalThis.__physicalRouteAuth('delayed'));
 await delay(150);
 assert.equal(await page.getByTestId('verified-studio').count(),0);
 await page.evaluate(()=>globalThis.__physicalRouteAuth('second'));
 await page.getByTestId('verified-studio').waitFor({timeout:15000});
 await page.evaluate(()=>globalThis.__physicalReleaseDelayed());
 await delay(150);
 assert.equal(await page.getByTestId('verified-studio').count(),1);
 console.log('GREEN PHYSICAL_STUDIO_ROUTE_STALE_ASYNC_AUTH_DOES_NOT_REPLACE_VERIFIED_SESSION');
 await page.evaluate(()=>globalThis.__physicalRouteAuth('signout'));
 await page.getByRole('status',{name:'Studio authority locked'}).waitFor({timeout:15000});
 assert.equal(await page.getByTestId('verified-studio').count(),0);
 console.log('GREEN PHYSICAL_STUDIO_ROUTE_SIGNOUT_UNMOUNTS_WORKSPACE');
 await page.evaluate(()=>globalThis.__physicalRouteAuth('first'));
 await page.getByTestId('verified-studio').waitFor({timeout:15000});
 await page.evaluate(()=>{history.pushState({},'', '/');dispatchEvent(new PopStateEvent('popstate'))});
 assert.equal(await page.getByTestId('verified-studio').count(),0);
 assert.deepEqual(errors,[],'browser route shell error: '+errors.join(' | '));
 assert.equal(readFileSync(root+'/src/App.jsx','utf8'),pinned);
 assert.equal(readFileSync(root+'/scripts/verify-movie-mentor-conversation-continuity.mjs','utf8'),regression);
 console.log('GREEN PHYSICAL_STUDIO_ROUTE_UNMOUNT_AND_PINNED_SOURCE_PRESERVED');
 console.log('HELD REAL_CLERK_SESSION_FACTORY_AND_ORIGINAL_LINE_71_RED');
}catch(error){
 console.error('PHYSICAL_ROUTE_BROWSER_FAILURE',error);
 if(page){console.error('URL',page.url());console.error('DOM',(await page.content().catch(()=>'' )).slice(0,8000));}
 console.error('PAGE_ERRORS',errors,'BROWSER_DIAGNOSTICS',browserDiagnostics,'VITE',logs.slice(-10000));
 throw error;
}finally{
 try{await browser?.close()}catch{}
 try{vite?.kill('SIGTERM')}catch{}
 for(const p of files){try{unlinkSync(p)}catch{}}
}
