// Exact-pinned full-file handler migration contract; diagnostic only.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {adoptedHandler,sourceHandler,transformPinnedStudioMessageHandler} from './isolated-studio-real-handler-adoption-candidate.mjs';
const source=readFileSync('./frontend/src/components/studio/CreatorWorkspace.jsx','utf8');
const modified=transformPinnedStudioMessageHandler(source);
assert.equal(modified.replace(adoptedHandler,source.match(sourceHandler)[0]),source,'all non-handler bytes must stay identical');
assert.match(modified,/lifecycle\.saveScene\(\{operationId,scene:nextScene\}\)/);
assert.match(modified,/message\.metadata\?\.backendMetadata\?\.creatorTurnId !== staged\.id/);
assert.doesNotMatch(modified.match(sourceHandler)[0],/settleConversationMessage|recordPendingCreatorMessage/);
console.log('GREEN REAL_STUDIO_HANDLER_FULL_FILE_MIGRATION_EXACT_SOURCE_BOUNDARY');
const prior=globalThis.__diagnosticStudioPending;
let state,project,setter,mentorText,status,mode='confirmed',sceneSaveCalls=0;
const life={
 getSnapshot(){return {active:project?.id,committed:{projectId:project?.id}};},
 async saveScene(){sceneSaveCalls++;if(mode==='unknown')return {ok:false};if(mode==='throw')throw Error('lost-response');return {ok:true};}
};
function render(){
 state=[];status='idle';mentorText='';
 globalThis.__diagnosticStudioPending=new Map();
 const setMovieMessages=next=>{state=typeof next==='function'?next(state):next};
 const setProjectStatus=next=>status=next;
 const setMentorMessage=next=>mentorText=next;
 const activeMovieProject=project;
 const workspaceHandler=Function('activeMovieProject','setMovieMessages','setProjectStatus','setMentorMessage',adoptedHandler+'\nreturn handleMovieMessage;');
 return workspaceHandler(activeMovieProject,setMovieMessages,setProjectStatus,setMentorMessage);
}
const flush=async()=>{for(let n=0;n<8;n++)await Promise.resolve()};
try{
 project={id:'film-a'};globalThis.__diagnosticStudioLifecycle=life;
 let handler=render();
 const creator={id:'turn-1',role:'creator',text:'Create the next scene'};
 const mentor={id:'scene-2',role:'mentor',text:'Night skyline',metadata:{backendMetadata:{creatorTurnId:'turn-1'}}};
 handler(creator);assert.equal(state.length,1);
 handler(mentor);await flush();assert.equal(status,'saved');assert.equal(state.length,2);
 assert.equal(globalThis.__diagnosticStudioPending.size,0);
 console.log('GREEN REAL_STUDIO_HANDLER_CONFIRMED_SCENE_PROJECTION');

 sceneSaveCalls=0;mode='unknown';handler=render();handler(creator);handler(mentor);await flush();
 assert.equal(status,'error');assert.equal(state.length,1);assert.equal(globalThis.__diagnosticStudioPending.size,1);
 console.log('GREEN REAL_STUDIO_HANDLER_UNKNOWN_RETAINS_PENDING_WITHOUT_MENTOR_PROJECTION');

 mode='confirmed';handler=render();handler(creator);
 handler({...mentor,metadata:{backendMetadata:{creatorTurnId:'forged'}}});
 await flush();assert.equal(sceneSaveCalls,1,'forged mentor must not call server');assert.equal(state.length,1);
 console.log('GREEN REAL_STUDIO_HANDLER_FORGED_MENTOR_PROVENANCE_DENIED');

 handler=render();
 handler(mentor);await flush();assert.equal(status,'error');assert.equal(state.length,0);
 console.log('GREEN REAL_STUDIO_HANDLER_UNSTAGED_MENTOR_DENIED');
 console.log('HELD PHYSICAL_STUDIO_HANDLER_MOUNT_AND_ORIGINAL_FRONTEND_RED');
}finally{
 globalThis.__diagnosticStudioPending=prior;
 delete globalThis.__diagnosticStudioLifecycle;
}
