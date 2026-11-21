import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createIsolatedStudioServerSelectionAdoption} from './isolated-studio-server-selection-adoption.mjs';
const pinned=readFileSync('./frontend/src/components/studio/CreatorWorkspace.jsx','utf8');
assert.match(pinned,/aria-label="Your saved movie projects"/);
assert.match(pinned,/This is a read-only preview; editing is not enabled/);
assert.match(pinned,/setServerRecoveredPreview\(null\)/);
assert.match(pinned,/const \[activeMovieProject, setActiveMovieProject\] = useState\(resumeSnapshot\?\.project \|\| null\)/);
console.log('GREEN PINNED_STUDIO_READ_ONLY_PROJECT_RECOVERY_SELECTOR_SOURCE_PRESERVED');
const selections=[];
const current={projectId:'vault',revision:1,activeProjectId:'film-a'};
let mode='ok',release;
const gate=new Promise(resolve=>release=resolve);
const authority={
 async read({token,projectId}){
  if(token!=='owner'||projectId!=='vault')return {ok:false};
  if(mode==='readfail')throw Error('down');
  if(mode==='delayed')await gate;
  if(mode==='wrongreadback')return {ok:true,projectId,revision:current.revision,activeProjectId:'film-a'};
  return {ok:true,...current};
 },
 async select({token,projectId,operationId,expectedRevision,nextActiveProjectId}){
  if(token!=='owner'||projectId!=='vault'||expectedRevision!==current.revision)return {ok:false};
  if(mode==='unknown')throw Error('lost receipt');
  if(mode==='denied')return {ok:false};
  if(mode==='forged')return {ok:true,receipt:{projectId,operationId,committedRevision:expectedRevision+1,serverCommitId:''}};
  if(mode==='delayedselect'){await gate}
  current.revision++;current.activeProjectId=nextActiveProjectId;
  return {ok:true,receipt:{projectId,operationId,committedRevision:current.revision,serverCommitId:'receipt-'+operationId}};
 }
};
const client=createIsolatedStudioServerSelectionAdoption({authority,onCommitted:state=>selections.push(state)});
assert.equal((await client.change({token:'owner',projectId:'vault',operationId:'switch',nextActiveProjectId:'film-b'})).reason,'selection-not-ready');
assert.equal((await client.load({token:'owner',projectId:'vault'})).ok,true);
assert.equal(client.getSnapshot().activeProjectId,'film-a');
for(const denial of ['unknown','denied','forged']){
 mode=denial;
 const res=await client.change({token:'owner',projectId:'vault',operationId:'switch-'+denial,nextActiveProjectId:'film-b'});
 assert.equal(res.ok,false,denial);
 assert.equal(client.getSnapshot().activeProjectId,'film-a',denial);
 assert.equal(current.revision,1,denial);
}
console.log('GREEN STUDIO_SELECTION_ADOPTION_UNKNOWN_AND_UNVERIFIED_RECEIPT_NO_PROJECTION');
mode='wrongreadback';
const bad=await client.change({token:'owner',projectId:'vault',operationId:'switch-badread',nextActiveProjectId:'film-b'});
assert.equal(bad.reason,'readback-unverified');
assert.equal(client.getSnapshot().activeProjectId,'film-a');
assert.equal(current.revision,2);
mode='ok';
const corrected=await client.load({token:'owner',projectId:'vault'});
assert.equal(corrected.ok,true);assert.equal(corrected.selection.activeProjectId,'film-b');
const good=await client.change({token:'owner',projectId:'vault',operationId:'switch-back',nextActiveProjectId:'film-a'});
assert.equal(good.ok,true);assert.equal(good.selection.revision,3);
assert.equal(selections.at(-1).activeProjectId,'film-a');
console.log('GREEN STUDIO_SELECTION_ADOPTION_SERVER_RECEIPT_READBACK_REQUIRED');
mode='delayed';
const pending=client.load({token:'owner',projectId:'vault'});
client.invalidate();release();
assert.equal((await pending).reason,'stale-selection');
assert.equal(client.getSnapshot(),null);
console.log('GREEN STUDIO_SELECTION_ADOPTION_STALE_ASYNC_RESPONSE_SUPPRESSED');
console.log('HELD REAL_REACT_MOUNTED_SELECTION_AND_ORIGINAL_FRONTEND_RED');
