// Characterize diagnostic lifecycle candidate against exact pinned Studio source.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createIsolatedStudioLifecycleCoordinator} from './isolated-real-studio-lifecycle-handoff.mjs';
const pinned=readFileSync('./frontend/src/components/studio/CreatorWorkspace.jsx','utf8');
for(const control of [
 'const resumeSnapshot = useMemo(() => identityRuntime.getResumeSnapshot()',
 'const [activeMovieProject, setActiveMovieProject] = useState(resumeSnapshot?.project || null)',
 'setResumeRepairStatus("certified-read-only")',
 'const handleMovieMessage = (message) => {',
 'identityRuntime.recordPendingCreatorMessage(activeMovieProject.id, message)',
 'settleConversationMessage(activeMovieProject.id, message'
])assert.ok(pinned.includes(control),'pinned Studio lifecycle seam missing: '+control);
assert.match(pinned,/setMovieMessages\(\(current\) => \[\.\.\.current, message\]\);/,'unchanged original optimistic publication must remain visible');
console.log('GREEN PINNED_STUDIO_PROJECT_RESUME_AND_OPTIMISTIC_PUBLICATION_GAP_PRESERVED');

function court({wrongReadback=false,failSave=false,delayedRead=false}={}){
 let projects=new Map([['film-a',{revision:1,state:{scenes:[{id:'scene-1',text:'Opening'}]}}],['film-b',{revision:3,state:{scenes:[]}}]]);
 const events=[],updates=[];
 let release;
 const barrier=new Promise(r=>release=r);
 const authority={
  async readProject(projectId){
   if(delayedRead&&projectId==='film-a')await barrier;
   const p=projects.get(projectId);
   return p?{ok:true,projectId,revision:p.revision,state:structuredClone(p.state)}:{ok:false};
  },
  async admit({projectId,operationId,expectedRevision}){
   const p=projects.get(projectId);events.push('admit:'+projectId);
   return p?.revision===expectedRevision?{ok:true,projectId,revision:p.revision,operationId,fence:'fence-'+projectId}:{ok:false};
  },
  async saveScene({projectId,operationId,expectedRevision,scene,fence}){
   events.push('save:'+projectId);
   if(failSave)throw Error('lost response');
   const p=projects.get(projectId);
   if(!p||fence!=='fence-'+projectId||p.revision!==expectedRevision)return {ok:false};
   p.revision++;p.state.scenes.push(structuredClone(scene));
   return {ok:true,projectId,operationId,committedRevision:p.revision,serverCommitId:'server-'+operationId};
  },
  async readCommitted({projectId,operationId}){
   events.push('readback:'+projectId);
   const p=projects.get(projectId);
   return {ok:true,projectId,operationId,revision:p.revision,serverCommitId:wrongReadback?'forged':'server-'+operationId,state:structuredClone(p.state)};
  }
 };
 const coordinator=createIsolatedStudioLifecycleCoordinator({authority,view:s=>updates.push(s)});
 return {coordinator,updates,events,release,projects};
}
const good=court();assert.ok(good.coordinator);
assert.equal((await good.coordinator.select('film-a')).mode,'read-only');
assert.equal((await good.coordinator.saveScene({operationId:'adopt:scene2',scene:{id:'scene2',text:'After restart'}})).reason,'not-writable');
assert.equal((await good.coordinator.requestWritable({operationId:'adopt'})).ok,true);
assert.equal((await good.coordinator.saveScene({operationId:'adopt:scene2',scene:{id:'scene2',text:'After restart'}})).ok,true);
assert.deepEqual(good.events,['admit:film-a','save:film-a','readback:film-a']);
assert.equal(good.coordinator.getSnapshot().committed.revision,2);
assert.equal(good.coordinator.getSnapshot().pending,null);
assert.equal(good.updates.at(-1).committed.state.scenes.length,2);
console.log('GREEN STUDIO_LIFECYCLE_SERVER_ADMISSION_AND_CONFIRMED_NEXT_SCENE_ONLY');

const lost=court({failSave:true});await lost.coordinator.select('film-a');await lost.coordinator.requestWritable({operationId:'adopt'});
assert.equal((await lost.coordinator.saveScene({operationId:'adopt:scene2',scene:{id:'scene2',text:'Safe pending'}})).reason,'outcome-unknown');
assert.equal(lost.coordinator.getSnapshot().pending.scene.id,'scene2');
assert.equal(lost.coordinator.getSnapshot().committed.state.scenes.length,1);
console.log('GREEN STUDIO_LIFECYCLE_UNKNOWN_RESULT_RETAINS_PENDING_NO_PUBLICATION');

const forged=court({wrongReadback:true});await forged.coordinator.select('film-a');await forged.coordinator.requestWritable({operationId:'adopt'});
assert.equal((await forged.coordinator.saveScene({operationId:'adopt:scene2',scene:{id:'scene2',text:'Safe pending'}})).reason,'readback-unverified');
assert.equal(forged.coordinator.getSnapshot().committed.revision,1);
assert.equal(forged.coordinator.getSnapshot().pending.scene.id,'scene2');
console.log('GREEN STUDIO_LIFECYCLE_FORGED_COMMIT_READBACK_DENIED');

const swapped=court({delayedRead:true});
const inFlight=swapped.coordinator.select('film-a');
assert.equal((await swapped.coordinator.select('film-b')).ok,true);
swapped.release();
assert.equal((await inFlight).reason,'stale-project-selection');
assert.equal(swapped.coordinator.getSnapshot().active,'film-b');
assert.equal(swapped.coordinator.getSnapshot().committed.revision,3);
console.log('GREEN STUDIO_LIFECYCLE_STALE_PROJECT_SELECTION_SUPPRESSED');
console.log('HELD PHYSICAL_REACT_STUDIO_LIFECYCLE_AND_ORIGINAL_FRONTEND_RED');
