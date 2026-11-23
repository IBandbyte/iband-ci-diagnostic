import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createApplicationOwnedStudioServices} from './isolated-application-owned-studio-service-composition.mjs';

const original=readFileSync('./frontend/src/components/studio/CreatorWorkspace.jsx','utf8');
const regression=readFileSync('./frontend/scripts/verify-movie-mentor-conversation-continuity.mjs','utf8');
assert.match(regression,/assert\.equal\(cleared\.acquired, true\)/);
assert.doesNotMatch(original,/applicationSecondFilm|studioRecoveryServices|studioServices/);
assert.throws(()=>createApplicationOwnedStudioServices(),/application-studio-service-dependencies-required/);
let token='owner',bytes='original-film-a-bytes',selected='film-a',selectionRevision=1,
  granted=false,admitted=false,revision=4;
const calls=[],views=[];
const scenes=[{id:'film-b-opening',text:'Film B opening'}];
const transport=async({path,token:author,body})=>{
 calls.push({path,token:author,body:structuredClone(body)});
 if(author!=='owner')return {ok:false};
 if(path==='/studio/selection-read')
  return {ok:true,projectId:'vault',activeProjectId:selected,revision:selectionRevision};
 if(path==='/studio/selection-change'){
  if(body.projectId!=='vault'||body.nextActiveProjectId!=='film-b'||
     !body.operationId)return {ok:false};
  selected='film-b';selectionRevision++;
  return {ok:true,projectId:'vault',activeProjectId:selected,revision:selectionRevision};
 }
 if(path==='/studio/read')
  return body.projectId==='film-b'?
    {ok:true,projectId:'film-b',revision,state:{scenes:structuredClone(scenes)}}:{ok:false};
 if(path==='/studio/publication-grant'){
  granted=true;return {grantId:'server-grant',projectId:'film-b',revision};
 }
 if(path==='/studio/admit-publication'){
  if(!granted)return {acquired:false};
  admitted=true;return {acquired:true,projectId:'film-b',
    operationId:body.operationId,revision,fence:'signed-fence'};
 }
 if(path==='/studio/read-admission')
  return admitted?{projectId:'film-b',operationId:body.operationId,
    revision,fence:'signed-fence'}:null;
 if(path==='/studio/fenced-read-committed')return {ok:false};
 return {ok:false};
};
const app=createApplicationOwnedStudioServices({
  transport,getToken:()=>token,selectionVaultId:'vault',
  readLocalBytes:()=>bytes,onView:v=>views.push(v)
});
const services=app.studioServices;
assert.equal(services.pending,null);
const early=await app.applicationSecondFilm.requestEditing({token,selectionVaultId:'vault',operationId:'adopt-film-b'});
assert.deepEqual(early,{ok:false,reason:'read-only-proof-required'});
assert.equal(granted,false);
const changed=await app.applicationSecondFilm.choose({
 token,selectionVaultId:'vault',nextProjectId:'film-b',selectionOperationId:'select-film-b',
 localMemory:{getState:()=>({journey:{activeProjectId:'film-a'}})}
});
assert.equal(changed.ok,true,JSON.stringify(changed));
assert.equal(changed.view.mode,'read-only');
assert.equal(changed.view.writable,false);
assert.equal(selected,'film-b');
assert.equal(bytes,'original-film-a-bytes');
assert.equal(granted,false);
console.log('GREEN APP_COMPOSITION_INJECTED_SERVER_SELECTED_FILM_B_READ_ONLY');
const opened=await app.applicationSecondFilm.requestEditing({token,selectionVaultId:'vault',operationId:'adopt-film-b'});
assert.equal(opened.ok,true,JSON.stringify(opened));
assert.equal(opened.view.mode,'server-editable');
assert.equal(opened.view.fence,'signed-fence');
assert.equal(services.editable.getSnapshot().serverOwned,true);
assert.equal(services.selection.getSnapshot().activeProjectId,'film-b');
assert.equal(app.recoveryServices().token,'owner');
assert.equal(app.recoveryServices().selectionVaultId,'vault');
assert.equal(app.recoveryServices().continuity.getSnapshot().mode,'server-editable');
console.log('GREEN APP_COMPOSITION_SERVER_PUBLICATION_GRANT_AND_FENCED_ADMISSION');
services.pending={projectId:'film-b',creator:{id:'creator-1'}};
assert.equal(services.pending.creator.id,'creator-1');
const countBefore= calls.filter(x=>x.path==='/studio/selection-change').length;
const fresh=await app.applicationSecondFilm.reopen({token,selectionVaultId:'vault',projectId:'film-b'});
assert.equal(fresh.ok,true);
assert.equal(fresh.view.mode,'read-only');
assert.equal(app.applicationSecondFilm.getEditable(),null);
assert.equal(calls.filter(x=>x.path==='/studio/selection-change').length,countBefore);
console.log('GREEN APP_COMPOSITION_FRESH_READONLY_WITHOUT_RESELECT_OR_LOCAL_REBASE');
bytes='unwitnessed-memory-tamper';
const denied=await app.applicationSecondFilm.requestEditing({token,selectionVaultId:'vault',operationId:'tampered-editor'});
assert.equal(denied.ok,false);
assert.equal(denied.reason,'local-memory-changed-before-admission');
assert.equal(app.applicationSecondFilm.getEditable(),null);
assert.equal(app.applicationSecondFilm.getReadOnly(),null);
console.log('GREEN APP_COMPOSITION_LOCAL_MEMORY_TAMPER_DENIED');
token='';
assert.throws(()=>app.recoveryServices(),/owner-token-unavailable/);
await assert.rejects(()=>services.request('/studio/fenced-save',{projectId:'film-b'}),/owner-token-unavailable/);
app.invalidate();
assert.equal(services.pending,null);
assert.equal(app.getContinuity(),null);
assert.equal(readFileSync('./frontend/src/components/studio/CreatorWorkspace.jsx','utf8'),original);
assert.equal(readFileSync('./frontend/scripts/verify-movie-mentor-conversation-continuity.mjs','utf8'),regression);
console.log('GREEN APP_COMPOSITION_NO_TOKEN_NO_LEGACY_WRITER_AND_INVALIDATION');
console.log('HELD ORIGINAL_FRONTEND_LINE_71_RED_AND_REAL_APPLICATION_ADOPTION');
