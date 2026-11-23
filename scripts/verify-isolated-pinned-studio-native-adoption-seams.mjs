import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inspectPinnedStudioMigration,verifyProposedNativeAdoption,pinnedStudioMigrationSeams} from './isolated-pinned-studio-application-adoption-seams.mjs';
const workspace=readFileSync('./frontend/src/components/studio/CreatorWorkspace.jsx','utf8');
const continuityTest=readFileSync('./frontend/scripts/verify-movie-mentor-conversation-continuity.mjs','utf8');
const memory=readFileSync('./frontend/src/components/studio/mentor/CreatorMemory.js','utf8');
const baseline=inspectPinnedStudioMigration({workspace,continuityTest,memory,frontEndSource:workspace});
assert.equal(baseline.ok,true,JSON.stringify(baseline.failures));
assert.equal(baseline.boundaries.localWriter,'unwitnessed-publication-outbox-remains-denied');
assert.match(continuityTest,/assert\.equal\(cleared\.acquired, true\)/);
console.log('GREEN PINNED_NATIVE_RECOVERY_HANDLER_AND_ORIGINAL_RED_SOURCE_EXACT');
for(const [name,anchor] of Object.entries(pinnedStudioMigrationSeams)){
 const key=name==='originalAssertion'?'continuityTest':name==='localProvenance'?'memory':'workspace';
 const altered={workspace,continuityTest,memory};
 altered[key]=altered[key].replace(anchor,'/* removed required authority */');
 const result=inspectPinnedStudioMigration(altered);
 assert.equal(result.ok,false,name);
 assert.ok(result.failures.includes('pinned-source-anchor-'+name),JSON.stringify(result.failures));
}
console.log('GREEN PINNED_NATIVE_MIGRATION_REJECTS_MISSING_RECOVERY_HANDLER_AND_SECURITY_BOUNDARIES');
const project='film-b';
const selection={activeProjectId:project,revision:2};
const editor={projectId:project,operationId:'adopt-film-b',fence:'server-owned-fence',writable:true};
const view={mode:'server-editable',writable:true,serverOwned:true,projectId:project,selectionRevision:2,
 operationId:editor.operationId,fence:editor.fence};
const valid=verifyProposedNativeAdoption({oldProjectId:'film-a',newProjectId:project,coordinatorView:view,selection,editor});
assert.equal(valid.ok,true);
for(const testcase of [
 {localWriterAcquired:true},
 {coordinatorView:{...view,mode:'read-only',writable:false}},
 {coordinatorView:{...view,serverOwned:false}},
 {coordinatorView:{...view,projectId:'film-a'}},
 {selection:{...selection,revision:1}},
 {selection:{...selection,activeProjectId:'film-a'}},
 {editor:{...editor,fence:'forged-fence'}},
 {editor:{...editor,operationId:'wrong-operation'}},
 {editor:null}
]){
 const result=verifyProposedNativeAdoption({oldProjectId:'film-a',newProjectId:project,
  coordinatorView:view,selection,editor,...testcase});
 assert.equal(result.ok,false,JSON.stringify(testcase));
}
console.log('GREEN PINNED_NATIVE_ADOPTION_REQUIRES_SERVER_FILM_RECEIPT_AND_EXACT_FENCED_ADMISSION');
console.log('HELD ORIGINAL_FRONTEND_RED_AND_NATIVE_REACT_APPLICATION_MIGRATION_PHYSICAL_GATE');
