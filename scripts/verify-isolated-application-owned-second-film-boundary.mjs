import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createApplicationSecondFilmBoundary} from './isolated-application-owned-second-film-boundary.mjs';
import {selectSecondFilmWithServerAuthority} from './isolated-original-continuity-second-film-migration.mjs';

const original=readFileSync('./frontend/scripts/verify-movie-mentor-conversation-continuity.mjs','utf8');
const workspace=readFileSync('./frontend/src/components/studio/CreatorWorkspace.jsx','utf8');
assert.match(original,/assert\.equal\(cleared\.acquired, true\)/);
assert.doesNotMatch(workspace,/__migratedSecondFilmCaller|__diagnosticFencedRequest/);
let bytes='persisted-original-film-a',selected='film-a',mode='selection-verified',switched=0;
let admission=false,interrupt=false,mutateDuringSwitch=false;
const calls=[],readonlyViews=[],editableViews=[];
const localMemory={getState:()=>({journey:{activeProjectId:'film-a'}})};
const continuity={
  async open({token,selectionVaultId}){
    calls.push('open');
    return token==='owner'&&selectionVaultId==='vault'
      ?{ok:true,view:{projectId:selected,writable:false}}:{ok:false};
  },
  async switchFilm({token,selectionVaultId,nextProjectId,operationId}){
    calls.push('switch');switched++;
    if(token!=='owner'||selectionVaultId!=='vault'||!operationId)
      return {ok:false};
    selected=nextProjectId;mode='selection-verified';
    if(mutateDuringSwitch)bytes='forged-local-rebase';
    return {ok:true,view:{projectId:selected,writable:false}};
  },
  async recover({token,selectionVaultId}){
    calls.push('recover');
    if(token!=='owner'||selectionVaultId!=='vault'||interrupt)return {ok:false};
    mode='read-only';
    return {ok:true,view:continuity.getSnapshot()};
  },
  async requestEditing({token,selectionVaultId,operationId}){
    calls.push('admit');
    if(!admission||token!=='owner'||selectionVaultId!=='vault')return {ok:false};
    mode='server-editable';
    return {ok:true,view:{...continuity.getSnapshot(),operationId,fence:'server-fence',
      serverOwned:true,writable:true}};
  },
  getSnapshot(){return {projectId:selected,mode,writable:mode==='server-editable',
    selectionRevision:2,projectRevision:4,
    scenes:[{id:'film-b-scene',text:'Film B'}]}}
};
const boundary=createApplicationSecondFilmBoundary({
  continuity,selectSecondFilm:selectSecondFilmWithServerAuthority,
  readLocalBytes:()=>bytes,
  onReadOnly:x=>readonlyViews.push(x),onEditable:x=>editableViews.push(x)
});
assert.deepEqual(await boundary.requestEditing({token:'owner',selectionVaultId:'vault',operationId:'adopt-b'}),
 {ok:false,reason:'read-only-proof-required'});
let result=await boundary.choose({token:'owner',selectionVaultId:'vault',nextProjectId:'film-b',
 selectionOperationId:'select-b',localMemory});
assert.equal(result.ok,true);
assert.equal(result.view.mode,'read-only');
assert.equal(result.view.writable,false);
assert.equal(switched,1);
assert.equal(bytes,'persisted-original-film-a');
assert.equal(boundary.getEditable(),null);
assert.equal(readonlyViews.at(-1).projectId,'film-b');
assert.deepEqual(calls,['open','open','switch','recover']);
console.log('GREEN APPLICATION_OWNED_FILM_B_SELECTION_READ_ONLY_NO_LOCAL_REBASE');

const denied=await boundary.requestEditing({token:'owner',selectionVaultId:'vault',operationId:'adopt-b'});
assert.equal(denied.ok,false);
assert.equal(boundary.getEditable(),null);
admission=true;
result=await boundary.requestEditing({token:'owner',selectionVaultId:'vault',operationId:'adopt-b'});
assert.equal(result.ok,true);
assert.equal(result.view.serverOwned,true);
assert.equal(result.view.fence,'server-fence');
assert.equal(editableViews.at(-1).projectId,'film-b');
console.log('GREEN APPLICATION_OWNED_WRITER_ONLY_AFTER_SERVER_FENCED_ADMISSION');

const before=switched;
result=await boundary.reopen({token:'owner',selectionVaultId:'vault',projectId:'film-b'});
assert.equal(result.ok,true);
assert.equal(result.view.writable,false);
assert.equal(switched,before);
assert.equal(boundary.getEditable(),null);
assert.equal(bytes,'persisted-original-film-a');
console.log('GREEN APPLICATION_OWNED_FRESH_REOPEN_READ_ONLY_NO_SECOND_SELECTION');

result=await boundary.reopen({token:'intruder',selectionVaultId:'vault',projectId:'film-b'});
assert.equal(result.ok,false);
assert.equal(boundary.getReadOnly(),null);
interrupt=true;
result=await boundary.reopen({token:'owner',selectionVaultId:'vault',projectId:'film-b'});
assert.equal(result.ok,false);
assert.equal(boundary.getEditable(),null);
interrupt=false;
selected='film-a';mode='selection-verified';mutateDuringSwitch=true;
result=await boundary.choose({token:'owner',selectionVaultId:'vault',nextProjectId:'film-b',
 selectionOperationId:'select-b-again',localMemory});
assert.equal(result.ok,false);
assert.equal(boundary.getEditable(),null);
assert.equal(boundary.getReadOnly(),null);
assert.equal(bytes,'forged-local-rebase');
console.log('GREEN APPLICATION_OWNED_INTRUDER_INTERRUPTION_AND_LOCAL_TAMPER_DENIAL');
console.log('HELD ORIGINAL_FRONTEND_LINE_71_RED_AND_TRUE_APP_INTEGRATION');
