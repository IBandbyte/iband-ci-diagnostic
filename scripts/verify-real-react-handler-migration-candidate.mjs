import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformPinnedCreatorWorkspace,handlerPattern,createDiagnosticHttpConversationAuthority} from './isolated-real-react-handler-migration-candidate.mjs';

const original=readFileSync('frontend/src/components/studio/CreatorWorkspace.jsx','utf8');
const candidate=transformPinnedCreatorWorkspace(original);
assert.ok(candidate.length>40000,'full pinned React source must be retained');
const match=candidate.match(handlerPattern);
assert.ok(match);
console.log('GREEN REAL_HANDLER_FULL_FILE_MIGRATION_CANDIDATE_REPLACES_LEGACY_SETTLEMENT');

const creator={id:'creator-live-1',role:'creator',text:'First scene'};
const mentor={id:'mentor-live-1',role:'mentor',text:'A wide establishing shot',metadata:{backendMetadata:{creatorTurnId:creator.id}}};
function makeCourt({settlementStatus=200,readbackRevision=1,readbackProjectId='film-1'}={}){
 const calls=[],snapshot={projectId:readbackProjectId,revision:readbackRevision,conversation:[creator,mentor]};
 let confirmed=false,display=[],status='idle',notice='',activeMovieProject={id:'film-1'};
 const request=async(path,options)=>{
  const body=JSON.parse(options.body);calls.push({path,body});
  if(path==='/conversation/read')return {status:200,data:confirmed?snapshot:{projectId:'film-1',revision:0,conversation:[]}};
  if(path==='/conversation/settle'){
   if(settlementStatus===200)confirmed=true;
   return {status:settlementStatus,data:{projectId:'film-1',creatorTurnId:creator.id,operationId:'studio-'+creator.id,committedRevision:1,serverCommitId:'atomic-studio-'+creator.id}};
  }
  throw Error('unexpected-path '+path);
 };
 const authority=createDiagnosticHttpConversationAuthority({request,token:'diagnostic-token'});
 const factory=new Function('authority','creator','mentor','setters','getProject',`
  const globalThis={__diagnosticConversationAuthority:authority};
  let activeMovieProject=getProject();
  const setMovieMessages=setters.messages,setProjectStatus=setters.status,setMentorMessage=setters.notice;
  ${match[0]}
  return {handleMovieMessage,setProject:project=>{activeMovieProject=project}};
 `);
 const instance=factory(authority,creator,mentor,{messages:fn=>display=fn(display),status:x=>status=x,notice:x=>notice=x},()=>activeMovieProject);
 return {authority,instance,calls,get:()=>({display,status,notice}),creator,mentor};
}
const flush=async()=>{for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve))};
const happy=makeCourt();
happy.instance.handleMovieMessage(creator);
assert.equal(happy.authority.getPending('film-1')?.id,creator.id);
happy.instance.handleMovieMessage(mentor);
assert.equal(happy.get().display.length,1,'mentor must not be published optimistically');
await flush();
assert.equal(happy.get().status,'saved');
assert.deepEqual(happy.get().display,[creator,mentor]);
assert.equal(happy.authority.hasPending('film-1'),false);
assert.deepEqual(happy.calls.map(c=>c.path),['/conversation/read','/conversation/settle','/conversation/read']);
assert.equal(happy.calls[1].body.projectId,'film-1');
assert.equal(happy.calls[1].body.creatorTurnId,creator.id);
assert.equal(happy.calls[1].body.expectedRevision,0);
console.log('GREEN REAL_HANDLER_AUTHENTICATED_SETTLEMENT_RECEIPT_AND_SERVER_READBACK_ONLY');

const unknown=makeCourt({settlementStatus:503});
unknown.instance.handleMovieMessage(creator);
unknown.instance.handleMovieMessage(mentor);
await flush();
assert.equal(unknown.get().status,'error');
assert.equal(unknown.authority.hasPending('film-1'),true);
assert.deepEqual(unknown.get().display,[creator]);
console.log('GREEN REAL_HANDLER_UNKNOWN_RESULT_RETAINS_PENDING_NO_OPTIMISTIC_MENTOR');

const forged=makeCourt({readbackRevision:8});
forged.instance.handleMovieMessage(creator);
forged.instance.handleMovieMessage(mentor);
await flush();
assert.equal(forged.get().status,'error');
assert.equal(forged.authority.hasPending('film-1'),true);
assert.deepEqual(forged.get().display,[creator]);
console.log('GREEN REAL_HANDLER_WRONG_REVISION_DENIED');

const switched=makeCourt();
switched.instance.handleMovieMessage(creator);
switched.instance.handleMovieMessage({...mentor,metadata:{backendMetadata:{creatorTurnId:'different-turn'}}});
assert.equal(switched.get().status,'error');
assert.equal(switched.calls.length,0);
assert.equal(switched.authority.hasPending('film-1'),true);
console.log('GREEN REAL_HANDLER_MENTOR_PROVENANCE_DENIED');
console.log('HELD PHYSICAL_MOUNTED_REACT_MONGO_MIGRATION_AND_ORIGINAL_FRONTEND_RED');
