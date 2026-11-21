// Diagnostic-only in-memory candidate against the exact pinned CreatorWorkspace handler.
// No production source is changed. This is not real UI integration certification.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createStudioServerAuthorityAdapter} from './isolated-studio-server-authority-adapter.mjs';

const source=readFileSync('frontend/src/components/studio/CreatorWorkspace.jsx','utf8');
const pattern=/const handleMovieMessage = \(message\) => \{([\s\S]*?)\n  \};/;
const original=source.match(pattern);
assert.ok(original,'real pinned Studio handler anchor required');
assert.match(original[0],/identityRuntime\.recordPendingCreatorMessage/);
assert.match(original[0],/identityRuntime\s*\.settleConversationMessage/);

// Candidate replacement of exactly one real handler, in-memory and never written to frontend.
const candidate=`const handleMovieMessage = (message) => {
    if (!activeMovieProject?.id) return;
    const projectId = activeMovieProject.id;
    if (message?.role === "creator") {
      if (state.pending) throw Error("unconfirmed-creator-turn-exists");
      state.pending = message;
      setMovieMessages(current => [...current, message]);
      return;
    }
    if (message?.role !== "mentor") return;
    const creatorMessage = state.pending;
    if (!creatorMessage) throw Error("pending-creator-turn-required");
    const creatorTurnId = creatorMessage.id;
    if (message?.metadata?.backendMetadata?.creatorTurnId !== creatorTurnId) throw Error("mentor-turn-provenance-required");
    setMovieMessages(current => [...current, message]);
    authority.stage({projectId,operationId:"studio-"+creatorTurnId,creatorTurnId,expectedRevision:state.revision,creatorMessage,mentorMessage:message});
    void authority.confirm(projectId,creatorTurnId).then(async outcome => {
      if (!outcome.durable) {
        setProjectStatus("error");
        setMentorMessage("The server outcome is unknown. Your pending creator turn is retained.");
        return;
      }
      const restored = await authority.restore(projectId);
      if (restored.published) {
        state.pending = null;
        state.revision = restored.revision;
      } else {
        setProjectStatus("error");
      }
    }).catch(() => setProjectStatus("error"));
  };`;
const transformed=source.replace(original[0],candidate);
assert.notEqual(transformed,source);
assert.equal((transformed.match(/const handleMovieMessage = \(message\) =>/g)||[]).length,1);
const installed=transformed.match(pattern);
assert.ok(installed);
assert.doesNotMatch(installed[0],/identityRuntime\.recordPendingCreatorMessage|identityRuntime\s*\.settleConversationMessage/);
console.log('GREEN PINNED_STUDIO_CANDIDATE_REPLACES_EXACT_LEGACY_HANDLER_IN_MEMORY');

const run=async (receipt)=>{
  const projectId='candidate-project';
  const creatorTurnId='candidate-turn';
  const creatorMessage={id:creatorTurnId,role:'creator',text:'Scene'};
  const mentorMessage={id:'candidate-mentor',role:'mentor',text:'Ready',metadata:{backendMetadata:{creatorTurnId}}};
  let display=[],confirmed=[],status='idle',notice='';
  const state={pending:null,revision:0};
  const authority=createStudioServerAuthorityAdapter({
    settle:async()=>receipt,
    readConfirmed:async()=>({projectId,revision:1,conversation:[creatorMessage,mentorMessage]}),
    publishConfirmed:async (recovered,{isCurrent})=>{if(isCurrent())confirmed=structuredClone(recovered.conversation);}
  });
  const factory=new Function('activeMovieProject','authority','state','setMovieMessages','setProjectStatus','setMentorMessage',installed[0]+'\nreturn handleMovieMessage;');
  const handler=factory({id:projectId},authority,state,updater=>{display=updater(display)},value=>{status=value},value=>{notice=value});
  handler(creatorMessage);
  assert.throws(()=>handler(creatorMessage),/unconfirmed-creator-turn-exists/);
  handler(mentorMessage);
  await new Promise(resolve=>setImmediate(resolve));
  return {authority,state,display,confirmed,status,notice,projectId,creatorTurnId};
};
const unknown=await run(null);
assert.equal(unknown.status,'error');
assert.match(unknown.notice,/outcome is unknown/);
assert.equal(unknown.state.pending.id,unknown.creatorTurnId);
assert.equal(unknown.authority.hasPending(unknown.projectId,unknown.creatorTurnId),true);
assert.equal((await unknown.authority.restore(unknown.projectId)).status,'blocked-pending');
assert.deepEqual(unknown.confirmed,[]);
console.log('GREEN PINNED_STUDIO_CANDIDATE_UNKNOWN_RETAINS_PENDING_AND_DENIES_CONFIRMED_PROJECTION');
const confirmed=await run({operationId:'studio-candidate-turn',creatorTurnId:'candidate-turn',serverCommitId:'commit-1',committedRevision:1});
assert.equal(confirmed.status,'idle');
assert.equal(confirmed.state.pending,null);
assert.equal(confirmed.state.revision,1);
assert.equal(confirmed.confirmed.length,2);
assert.equal(confirmed.display.length,2);
console.log('GREEN PINNED_STUDIO_CANDIDATE_RECEIPT_DRIVES_CONFIRMED_SERVER_PROJECTION');
console.log('HELD PRODUCTION_CREATOR_WORKSPACE_WIRING_AND_ORIGINAL_FRONTEND_RED');
