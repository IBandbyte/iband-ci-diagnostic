// Disposable full-file migration candidate for the real pinned Studio message handler.
// No modification of application source. Must pass a physical court before adoption.
import assert from 'node:assert/strict';
export const sourceHandler=/const handleMovieMessage = \(message\) => \{([\s\S]*?)\n  \};/;
export const adoptedHandler=`const handleMovieMessage = (message) => {
    const projectId = activeMovieProject?.id;
    const lifecycle = globalThis.__diagnosticStudioLifecycle;
    if (!projectId || !message?.id || !lifecycle) { setProjectStatus("error"); return; }
    const identity = lifecycle.getSnapshot();
    if (identity.active !== projectId || identity.committed?.projectId !== projectId) {
      setProjectStatus("error"); return;
    }
    if (message.role === "creator") {
      if (globalThis.__diagnosticStudioPending?.has(projectId)) {
        setProjectStatus("error"); return;
      }
      globalThis.__diagnosticStudioPending ||= new Map();
      globalThis.__diagnosticStudioPending.set(projectId, message);
      setMovieMessages(current => [...current, message]);
      return;
    }
    if (message.role !== "mentor") return;
    const staged = globalThis.__diagnosticStudioPending?.get(projectId);
    if (!staged || message.metadata?.backendMetadata?.creatorTurnId !== staged.id) {
      setProjectStatus("error"); return;
    }
    const operationId = "adopt-" + projectId + ":" + staged.id;
    const nextScene = { id: message.id, text: message.text };
    void lifecycle.saveScene({operationId,scene:nextScene})
      .then(result => {
        if (!result?.ok || lifecycle.getSnapshot().active !== projectId) {
          setProjectStatus("error"); return;
        }
        globalThis.__diagnosticStudioPending.delete(projectId);
        setMovieMessages(current => [...current, message]);
        setProjectStatus("saved");
      })
      .catch(() => {
        setProjectStatus("error");
        setMentorMessage("The server result is unconfirmed. Your pending scene is retained for recovery.");
      });
  };`;
export function transformPinnedStudioMessageHandler(source){
 const matches=[...source.matchAll(new RegExp(sourceHandler.source,'g'))];
 assert.equal(matches.length,1,'expected exactly one pinned Studio handler');
 assert.match(matches[0][0],/recordPendingCreatorMessage/);
 assert.match(matches[0][0],/settleConversationMessage/);
 const updated=source.replace(matches[0][0],adoptedHandler);
 assert.equal((updated.match(/const handleMovieMessage = \(message\) =>/g)||[]).length,1);
 assert.doesNotMatch(updated.match(sourceHandler)[0],/settleConversationMessage|recordPendingCreatorMessage/);
 return updated;
}
