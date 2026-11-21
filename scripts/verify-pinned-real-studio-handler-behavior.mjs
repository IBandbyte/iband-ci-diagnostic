// Characterization court: executes the actual pinned CreatorWorkspace handler with controlled dependencies.
// This deliberately proves the existing optimistic/local path; it does NOT certify server wiring.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync('frontend/src/components/studio/CreatorWorkspace.jsx','utf8');
const match=source.match(/const handleMovieMessage = \(message\) => \{([\s\S]*?)\n  \};/);
assert.ok(match,'pinned CreatorWorkspace handler must be present');
const calls=[];let messages=[];let status='idle';let mentorNotice='';
const identityRuntime={
 recordPendingCreatorMessage:(projectId,message)=>calls.push(['pending',projectId,message.id]),
 settleConversationMessage:(projectId,message)=>{calls.push(['settle',projectId,message.id]);return Promise.reject(Error('server-outcome-unknown'))}
};
const setMovieMessages=updater=>{messages=updater(messages)};
const setProjectStatus=value=>{status=value};
const setMentorMessage=value=>{mentorNotice=value};
const activeMovieProject={id:'project-a'};
const projectJourneySnapshot=null,projectJourney=null;
const handleMovieMessage=new Function('setMovieMessages','activeMovieProject','projectJourneySnapshot','projectJourney','identityRuntime','setProjectStatus','setMentorMessage','console',`return (message) => {${match[1]}
}`)(setMovieMessages,activeMovieProject,projectJourneySnapshot,projectJourney,identityRuntime,setProjectStatus,setMentorMessage,{error:()=>{}});
handleMovieMessage({id:'creator-a',role:'creator',text:'Scene'});
assert.deepEqual(calls,[['pending','project-a','creator-a']]);
assert.equal(messages.length,1);
console.log('GREEN REAL_HANDLER_CREATOR_TURN_OPTIMISTIC_AND_LOCAL_PENDING_CHARACTERIZED');
handleMovieMessage({id:'mentor-a',role:'mentor',text:'Ready'});
assert.deepEqual(calls[1],['settle','project-a','mentor-a']);
assert.equal(messages.length,2,'mentor reply currently appears before settlement confirmation');
await new Promise(resolve=>setImmediate(resolve));
assert.equal(status,'error');
assert.match(mentorNotice,/pending creator turn has been kept/);
assert.equal(messages.length,2,'unknown settlement must not be mistaken for a confirmed readback');
console.log('GREEN REAL_HANDLER_UNKNOWN_SETTLEMENT_ERROR_PATH_CHARACTERIZED');
console.log('HELD REAL_HANDLER_SERVER_RECEIPT_ADMISSION_AND_DURABLE_UI_PROJECTION');
console.log('HELD ORIGINAL_FRONTEND_RED_AND_PHASE_01');
