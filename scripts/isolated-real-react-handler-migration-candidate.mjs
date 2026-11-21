// Diagnostic migration of exactly the pinned REAL CreatorWorkspace conversation handler.
// Produces a full-file candidate in memory; never edits either application's repository.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
export const handlerPattern=/const handleMovieMessage = \(message\) => \{([\s\S]*?)\n  \};/;
export const replacement=`const handleMovieMessage = (message) => {
    const projectId = activeMovieProject?.id;
    if (!projectId || !message?.id) return;
    const authority = globalThis.__diagnosticConversationAuthority;
    if (!authority) { setProjectStatus("error"); return; }
    if (message.role === "creator") {
      if (authority.hasPending(projectId)) { setProjectStatus("error"); return; }
      authority.stage(projectId,message);
      setMovieMessages(current => [...current,message]);
      return;
    }
    if (message.role !== "mentor") return;
    const pending = authority.getPending(projectId);
    if (!pending || message.metadata?.backendMetadata?.creatorTurnId !== pending.id) {
      setProjectStatus("error"); return;
    }
    const expectedProjectId = projectId;
    void authority.settle({projectId,creatorMessage:pending,mentorMessage:message})
      .then(async result => {
        if (!result?.receipt || result.receipt.creatorTurnId !== pending.id) throw Error("receipt-unverified");
        const recovered = await authority.readConfirmed(projectId);
        if (!recovered || recovered.projectId !== expectedProjectId ||
            recovered.revision !== result.receipt.committedRevision ||
            !Array.isArray(recovered.conversation) ||
            !recovered.conversation.some(m => m.id === pending.id) ||
            !recovered.conversation.some(m => m.id === message.id)) throw Error("readback-unverified");
        if (activeMovieProject?.id !== expectedProjectId) return;
        authority.retire(expectedProjectId,pending.id);
        setMovieMessages(recovered.conversation);
        setProjectStatus("saved");
      })
      .catch(() => {
        setProjectStatus("error");
        setMentorMessage("The server result is unconfirmed. Your pending creator turn remains available for recovery.");
      });
  };`;
export function transformPinnedCreatorWorkspace(source) {
 const matches=[...source.matchAll(new RegExp(handlerPattern.source,'g'))];
 assert.equal(matches.length,1,'must locate exactly one real handler');
 assert.match(matches[0][0],/recordPendingCreatorMessage/);
 assert.match(matches[0][0],/settleConversationMessage/);
 const fullFile=source.replace(matches[0][0],replacement);
 assert.equal((fullFile.match(/const handleMovieMessage = \(message\) =>/g)||[]).length,1);
 assert.equal(fullFile.includes(matches[0][0]),false);
 assert.doesNotMatch(fullFile.match(handlerPattern)[0],/recordPendingCreatorMessage|settleConversationMessage/);
 return fullFile;
}
// Typed runtime service for testing, isolated from any application main branch.
export function createDiagnosticHttpConversationAuthority({request,token}) {
 const pending=new Map(), operationIds=new Map();
 const post=(path,body)=>request(path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});
 const key=(projectId,id)=>projectId+':'+id;
 return {
  hasPending:projectId=>pending.has(projectId),
  getPending:projectId=>pending.get(projectId)||null,
  stage(projectId,creator){if(pending.has(projectId))throw Error('pending-conflict');pending.set(projectId,creator)},
  retire(projectId,id){if(pending.get(projectId)?.id!==id)throw Error('pending-identity-conflict');pending.delete(projectId)},
  async settle({projectId,creatorMessage,mentorMessage}){
   if(pending.get(projectId)?.id!==creatorMessage.id)throw Error('missing-pending');
   if(mentorMessage.metadata?.backendMetadata?.creatorTurnId!==creatorMessage.id)throw Error('mentor-provenance');
   const k=key(projectId,creatorMessage.id);
   if(!operationIds.has(k))operationIds.set(k,'studio-'+creatorMessage.id);
   const confirmed=await post('/conversation/read',{projectId});
   if(confirmed.status!==200)throw Error('revision-read-denied');
   const revision=confirmed.data.revision;
   const input={projectId,operationId:operationIds.get(k),creatorTurnId:creatorMessage.id,expectedRevision:revision,creatorMessage,mentorMessage};
   const settled=await post('/conversation/settle',input);
   if(settled.status!==200)throw Error('settlement-unconfirmed');
   return {receipt:settled.data};
  },
  async readConfirmed(projectId){
   const response=await post('/conversation/read',{projectId});
   if(response.status!==200)throw Error('confirmed-read-denied');
   return response.data;
  }
 };
}
