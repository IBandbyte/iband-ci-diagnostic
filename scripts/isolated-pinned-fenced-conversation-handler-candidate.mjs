// Disposable replacement of the ONE real pinned CreatorWorkspace handler.
// The actual handleMovieMessage callback is exercised in mounted React.
// No app-main changes. Fail closed on unknown HTTP settlement.
import assert from 'node:assert/strict';
import {sourceHandler} from './isolated-studio-real-handler-adoption-candidate.mjs';
export function transformPinnedFencedConversationHandler(source){
 const matches=[...source.matchAll(new RegExp(sourceHandler.source,'g'))];
 assert.equal(matches.length,1,'expected one pinned CreatorWorkspace handler');
 assert.match(matches[0][0],/recordPendingCreatorMessage/);
 assert.match(matches[0][0],/settleConversationMessage/);
 const replacement=`const handleMovieMessage = (message) => {
    const projectId = activeMovieProject?.id;
    const authority = globalThis.__applicationEditable?.getSnapshot?.();
    if (!projectId || !message?.id || authority?.projectId !== projectId || authority?.writable !== true) {
      setProjectStatus("error"); return;
    }
    const selection = globalThis.__serverSelection?.getSnapshot?.();
    if (selection?.activeProjectId !== projectId || selection?.revision !== authority.selectionRevision) {
      setProjectStatus("error"); return;
    }
    if (message.role === "creator") {
      if (globalThis.__diagnosticConversationPending) { setProjectStatus("error"); return; }
      globalThis.__diagnosticConversationPending = {projectId, creator:message};
      setMovieMessages(current=>[...current,message]);
      return;
    }
    if (message.role !== "mentor") return;
    const pending=globalThis.__diagnosticConversationPending;
    if (!pending || pending.projectId !== projectId ||
        message.metadata?.backendMetadata?.creatorTurnId !== pending.creator.id) {
      setProjectStatus("error");return;
    }
    const operationId=authority.operationId+":"+pending.creator.id;
    const scene={id:message.id,text:message.text};
    void globalThis.__diagnosticFencedRequest("/studio/fenced-save",{
      projectId,operationId,fence:authority.fence,expectedRevision:authority.revision,
      scene,simulateSocketLoss:true
    }).then(async receipt=>{
      if (!receipt?.ok || receipt.projectId !== projectId || receipt.operationId !== operationId ||
          receipt.committedRevision !== authority.revision+1 || !receipt.serverCommitId)
        throw Error("unverified-settlement");
      const readback=await globalThis.__diagnosticFencedRequest("/studio/fenced-read-committed",{projectId,operationId});
      if (!readback?.ok || readback.serverCommitId !== receipt.serverCommitId ||
          readback.revision !== receipt.committedRevision ||
          !readback.state?.scenes?.some(s=>s.id===scene.id&&s.text===scene.text))
        throw Error("unverified-readback");
      const fresh=globalThis.__applicationEditable?.getSnapshot?.();
      if (fresh?.projectId !== projectId || fresh?.fence !== authority.fence) return;
      globalThis.__diagnosticConversationPending=null;
      setMovieMessages(current=>[...current,message]);
      setProjectStatus("saved");
    }).catch(()=>{
      setProjectStatus("error");
      setMentorMessage("The server result is unconfirmed. Your creator turn remains pending for authoritative recovery.");
    });
  };`;
 const changed=source.replace(matches[0][0],replacement);
 assert.equal((changed.match(/const handleMovieMessage = \(message\) =>/g)||[]).length,1);
 assert.doesNotMatch(changed.match(sourceHandler)[0],/recordPendingCreatorMessage|settleConversationMessage/);
 return changed;
}
