// Physical React Router examination of pinned Studio route shell candidate.
// Runs in an isolated Chromium browser, with controlled test auth and a
// tiny read-only workspace to observe whether the shell actually mounts.
// Previously-certified native React/Mongo courts remain separate.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,unlinkSync,mkdtempSync,rmSync} from 'node:fs';
import {basename} from 'node:path';
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
 root+'/'+base+'_vite.config.mjs',
 root+'/src/'+base+'_ClerkFixture.jsx'
];
let vite,browser,page,logs='',moduleDir;
const errors=[],browserDiagnostics=[];
try{
 const pinned=readFileSync(root+'/src/App.jsx','utf8');
 const pinnedMain=readFileSync(root+'/src/main.jsx','utf8');
 const bridgePath=root+'/src/components/studio/mentor/MovieMentorCreatorAuthenticationBridge.jsx';
 const pinnedBridge=readFileSync(bridgePath,'utf8');
 assert.match(pinnedMain,/<React.StrictMode>/);
 assert.match(pinnedMain,/<MovieMentorCreatorAuthenticationBridge\s*\/>/);
 assert.match(pinnedBridge,/useAuth\(\)/);
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
 // Copy exact diagnostic composition and its relative module graph into a disposable directory.
 moduleDir=mkdtempSync(root+'/src/'+base+'_modules_');
 const copied=new Set();
 function copyModule(name){
  assert.match(name,/^isolated-[a-z0-9-]+\.mjs$/);
  if(copied.has(name))return;
  copied.add(name);
  const source=readFileSync('../scripts/'+name,'utf8');
  for(const match of source.matchAll(/from\s+['"]\.\/([^'"]+)['"]/g))copyModule(match[1]);
  writeFileSync(moduleDir+'/'+name,source);
 }
 copyModule('isolated-application-studio-async-clerk-session-adapter.mjs');
 // The real pinned bridge is mounted unchanged; only its Clerk hook is
 // replaced by a controlled provider in this disposable browser build.
 writeFileSync(files[7],`import React,{createContext,useContext,useState} from 'react';
const Context=createContext({isLoaded:false,isSignedIn:false,getToken:null});
export function useAuth(){return useContext(Context)}
export function FixtureProvider({children}){
 const [state,setState]=useState({isLoaded:false,isSignedIn:false,getToken:null});
 globalThis.__fixtureSetAuth=setState;
 return <Context.Provider value={state}>{children}</Context.Provider>;
}`);
 writeFileSync(files[1],`import {createAsyncAuthenticatedStudioSession} from './${basename(moduleDir)}/isolated-application-studio-async-clerk-session-adapter.mjs';import React from 'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router-dom';import App from './${base}_App.jsx';import MovieMentorCreatorAuthenticationBridge from './components/studio/mentor/MovieMentorCreatorAuthenticationBridge.jsx';import {FixtureProvider} from './${base}_ClerkFixture.jsx';
let release=null;let generations=0;globalThis.__physicalRouteDebug={getGenerations:()=>generations};globalThis.__physicalRouteAuth=(kind)=>{if(kind==='signout')return globalThis.__fixtureSetAuth({isLoaded:true,isSignedIn:false,getToken:null});if(kind==='delayed'){let resolve;const promise=new Promise(r=>resolve=r);release=resolve;globalThis.__fixtureSetAuth({isLoaded:true,isSignedIn:true,getToken:()=>promise});return;}globalThis.__fixtureSetAuth({isLoaded:true,isSignedIn:true,getToken:async()=>kind==='second'?'token-2':'token-1'});};
globalThis.__physicalReleaseDelayed=()=>{release?.('stale-token');release=null};
let requests=[];let sessions=[];globalThis.__physicalSessions=sessions;globalThis.__physicalRequests=requests;
export function createPhysicalSession({getAuthToken}){
 generations++;
 const session=createAsyncAuthenticatedStudioSession({getAuthToken,selectionVaultId:'vault',readLocalBytes:()=>localStorage.getItem('iband.creator-memory'),transport:async({path,token,body})=>{requests.push({path,token,body});return {ok:true,projectId:body.projectId}}});
 sessions.push(session);
 return session;
}
history.replaceState({},'', '/studio');
createRoot(document.getElementById('root')).render(<React.StrictMode><FixtureProvider><MovieMentorCreatorAuthenticationBridge/><BrowserRouter><App/></BrowserRouter></FixtureProvider></React.StrictMode>);`);
 writeFileSync(files[5],`<html><body><div id="root"></div><script type="module" src="/src/${base}_entry.jsx"></script></body></html>`);
 writeFileSync(files[6],`import{defineConfig}from'vite';import react from'@vitejs/plugin-react-swc';import{resolve}from'node:path';export default defineConfig({plugins:[react()],resolve:{alias:[{find:'@clerk/react',replacement:resolve('src/${base}_ClerkFixture.jsx')}]}});`);
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
 await page.waitForFunction(()=>globalThis.__physicalSessions.length>=1);
 await page.evaluate(()=>globalThis.__physicalRouteAuth('second'));
 await page.getByTestId('verified-studio').waitFor({timeout:15000});
 await page.evaluate(()=>globalThis.__physicalReleaseDelayed());
 await delay(150);
 assert.equal(await page.getByTestId('verified-studio').count(),1);
 const probe=await page.evaluate(async()=>{
  const sessions=globalThis.__physicalSessions;
  const live=sessions.at(-1).getServices();
  const stale=sessions.at(-2).getServices();
  if(stale!==null||live.recoveryServices().token!=='token-2')throw Error('wrong session');
  globalThis.__retainedStudioServices=live;
  await live.studioServices.request('/studio/read',{projectId:'film-b'});
  return globalThis.__physicalRequests;
 });
 assert.deepEqual(probe,[{path:'/studio/read',token:'token-2',body:{projectId:'film-b'}}]);
 console.log('GREEN PHYSICAL_STUDIO_ROUTE_STALE_ASYNC_AUTH_DOES_NOT_REPLACE_VERIFIED_SESSION');
 console.log('GREEN PHYSICAL_STUDIO_ROUTE_REAL_ASYNC_COMPOSITION_TOKEN_BOUND_REQUEST');
 await page.evaluate(()=>globalThis.__physicalRouteAuth('signout'));
 await page.getByRole('status',{name:'Studio authority locked'}).waitFor({timeout:15000});
 assert.equal(await page.getByTestId('verified-studio').count(),0);
 assert.equal(await page.evaluate(async()=>{
  try{await globalThis.__retainedStudioServices.studioServices.request('/studio/read',{projectId:'film-b'});return false}catch{return globalThis.__physicalRequests.length===1&&globalThis.__physicalSessions.at(-1).getServices()===null}
 }),true);
 console.log('GREEN PHYSICAL_STUDIO_ROUTE_SIGNOUT_UNMOUNTS_WORKSPACE');
 console.log('GREEN PHYSICAL_STUDIO_ROUTE_SIGNOUT_REVOKES_RETAINED_COMPOSED_SERVICES');
 await page.evaluate(()=>globalThis.__physicalRouteAuth('first'));
 await page.getByTestId('verified-studio').waitFor({timeout:15000});
 await page.evaluate(()=>{history.pushState({},'', '/');dispatchEvent(new PopStateEvent('popstate'))});
 await page.getByTestId('verified-studio').waitFor({state:'detached',timeout:15000});
 assert.equal(await page.getByTestId('verified-studio').count(),0);
 await page.waitForFunction(()=>globalThis.__physicalSessions.at(-1).getServices()===null);
 assert.deepEqual(errors,[],'browser route shell error: '+errors.join(' | '));
 assert.equal(readFileSync(root+'/src/App.jsx','utf8'),pinned);
 assert.equal(readFileSync(root+'/scripts/verify-movie-mentor-conversation-continuity.mjs','utf8'),regression);
 assert.equal(readFileSync(bridgePath,'utf8'),pinnedBridge);
 assert.equal(readFileSync(root+'/src/main.jsx','utf8'),pinnedMain);
 console.log('GREEN PHYSICAL_PINNED_CLERK_BRIDGE_STRICT_MODE_CONTROLLED_AUTH_LIFECYCLE');
 console.log('GREEN PHYSICAL_STUDIO_ROUTE_UNMOUNT_AND_PINNED_SOURCE_PRESERVED');
 console.log('HELD LIVE_CLERK_AND_PHYSICAL_ROUTE_HTTP_MONGO_COMPOSITION_AND_ORIGINAL_LINE_71_RED');
}catch(error){
 console.error('PHYSICAL_ROUTE_BROWSER_FAILURE',error);
 if(page){console.error('URL',page.url());console.error('DOM',(await page.content().catch(()=>'' )).slice(0,8000));}
 console.error('PAGE_ERRORS',errors,'BROWSER_DIAGNOSTICS',browserDiagnostics,'VITE',logs.slice(-10000));
 throw error;
}finally{
 try{await browser?.close()}catch{}
 try{vite?.kill('SIGTERM')}catch{}
 for(const p of files){try{unlinkSync(p)}catch{}}
 if(moduleDir)rmSync(moduleDir,{recursive:true,force:true});
}
