// Source-exact application migration boundary for the pinned frontend.
// No rewriting of CreatorMemory, original continuity test, or application main.
// This gate rejects "just set activeMovieProject" as a fake adoption.
export const pinnedStudioMigrationSeams=Object.freeze({
  activeProject:'const [activeMovieProject, setActiveMovieProject] = useState(resumeSnapshot?.project || null);',
  conversation:'const handleMovieMessage = (message) => {',
  legacyMentor:'.settleConversationMessage(activeMovieProject.id, message, { projectJourney: journey })',
  legacyCreator:'identityRuntime.recordPendingCreatorMessage(activeMovieProject.id, message);',
  readOnlyText:'This is a read-only preview; editing is not enabled.',
  existingRecovery:'<button type="button" onClick={requestServerRecovery} disabled={recoveryStatus === "loading"}>Recover movie preview</button>',
  nativeMessages:'messages={movieMessages}',
  nativeSend:'onSendMessage={handleMovieMessage}',
  originalAssertion:'assert.equal(cleared.acquired, true);',
  localProvenance:'publication-outbox-provenance-unverified'
});
const once=(source,needle)=>source.split(needle).length===2;
export function inspectPinnedStudioMigration({workspace,continuityTest,memory,frontEndSource}={}){
 const failures=[];
 if(typeof workspace!=='string'||typeof continuityTest!=='string'||typeof memory!=='string')return {ok:false,failures:['sources-required']};
 for(const [label,value] of Object.entries(pinnedStudioMigrationSeams)){
  const text=label==='originalAssertion'?continuityTest:label==='localProvenance'?memory:workspace;
  if(!once(text,value))failures.push('pinned-source-anchor-'+label);
 }
 // The real recovery UI is still read-only; native editing must not
 // activate merely because a remote preview was rendered.
 if(/serverRecoveredPreview[\s\S]{0,200}setActiveMovieProject\(/.test(workspace))
  failures.push('preview-cannot-adopt-local-project');
 if(!workspace.includes('onSendMessage={handleMovieMessage}'))failures.push('native-handler-required');
 if(frontEndSource!==undefined && frontEndSource!==workspace)failures.push('original-source-changed');
 return {ok:failures.length===0,failures,
  boundaries:Object.freeze({
   preview:'read-only-no-creator-memory-write',
   selection:'owner-authenticated-server-receipt-and-readback',
   admission:'independent-publication-provenance-grant-fence',
   conversation:'native-handleMovieMessage-needs-server-fenced-settlement',
   restart:'read-only-until-fresh-evidence',
   localWriter:'unwitnessed-publication-outbox-remains-denied'
  })};
}
export function verifyProposedNativeAdoption({oldProjectId,newProjectId,coordinatorView,selection,editor,localWriterAcquired=false}={}){
 if(localWriterAcquired)return {ok:false,reason:'local-provenance-bypass'};
 if(!newProjectId||newProjectId===oldProjectId)return {ok:false,reason:'distinct-film-required'};
 if(coordinatorView?.mode!=='server-editable'||coordinatorView?.writable!==true||
    coordinatorView?.serverOwned!==true||coordinatorView?.projectId!==newProjectId)
  return {ok:false,reason:'server-editor-not-verified'};
 if(selection?.activeProjectId!==newProjectId||
    selection?.revision!==coordinatorView.selectionRevision)
  return {ok:false,reason:'server-selection-stale'};
 if(editor?.projectId!==newProjectId||editor?.fence!==coordinatorView.fence||
    editor?.operationId!==coordinatorView.operationId||
    editor?.writable!==true||!editor.fence)
  return {ok:false,reason:'writer-admission-unverified'};
 return {ok:true,projectId:newProjectId,operationId:editor.operationId,fence:editor.fence};
}
