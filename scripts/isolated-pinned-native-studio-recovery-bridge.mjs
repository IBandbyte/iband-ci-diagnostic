// Disposable source-exact bridge into the pinned *native* Studio recovery section.
// The existing recovery preview remains untouched and read-only. This inserts a
// separately-labelled server-authorised recovery operation next to it.
// Application main and CreatorMemory source are never modified.
import assert from 'node:assert/strict';
export function transformPinnedNativeRecoveryControls(source){
 const button='<button type="button" onClick={requestServerRecovery} disabled={recoveryStatus === "loading"}>Recover movie preview</button>';
 const state='const [serverRecoveredPreview, setServerRecoveredPreview] = useState(null);';
 const end='const activeCreator = useMemo(';
 for(const [name,anchor] of [['native-preview',button],['server-preview-state',state],['recovery-boundary',end]]){
  assert.equal(source.split(anchor).length,2,'pinned native Studio source drift: '+name);
 }
 const handler=`const requestVerifiedServerFilm = async () => {
    const target = recoveryProjectId.trim();
    const controller = globalThis.__continuity;
    const selectionVaultId = "physical-studio-selection-vault";
    if (!target || !controller) {
      setRecoveryStatus("failed"); setRecoveryError("Server authority is unavailable."); return;
    }
    setRecoveryStatus("loading"); setRecoveryError(null);
    try {
      const token = globalThis.__diagnosticToken;
      const opened = await controller.open({token, selectionVaultId});
      if (!opened?.ok) throw Error("server-selection-denied");
      if (opened.view.projectId !== target) {
        const switched = await controller.switchFilm({token,selectionVaultId,
          operationId:"select-film-b",nextProjectId:target});
        if (!switched?.ok) throw Error("film-selection-denied");
      }
      const recovered = await controller.recover({token,selectionVaultId});
      if (!recovered?.ok || recovered.view?.projectId !== target ||
          recovered.view?.mode !== "read-only" || recovered.view.writable !== false)
        throw Error("read-only-recovery-denied");
      setRecoveryStatus("preview-ready");
      setServerRecoveredPreview({
        project:{title:"Server-verified "+target},
        projectJourney:{currentStageId:"read-only",currentTaskId:"not-admitted"},
        revision:recovered.view.projectRevision,
        conversationMessages:recovered.view.scenes.map(s=>({text:s.text}))
      });
    } catch {
      setRecoveryStatus("failed");
      setServerRecoveredPreview(null);
      setRecoveryError("Server-authorised recovery was denied. Editing remains blocked.");
    }
  };
  const requestVerifiedServerEditing = async () => {
    const selected = globalThis.__continuity?.getSnapshot?.();
    if (selected?.mode !== "read-only" || selected.projectId !== recoveryProjectId.trim()) {
      setRecoveryError("Recover the selected movie read-only before requesting editing."); return;
    }
    const result = await globalThis.__continuity.requestEditing({
      token:globalThis.__diagnosticToken,
      selectionVaultId:"physical-studio-selection-vault",operationId:"adopt-film-b"
    });
    if (!result?.ok || result.view?.mode !== "server-editable" ||
        result.view.projectId !== recoveryProjectId.trim()) {
      setRecoveryError("Server-authorised editing denied."); return;
    }
    setRecoveryError(null);
  };
  `;
 let changed=source.replace(end,handler+end);
 changed=changed.replace(button,button+
  '<button type="button" onClick={requestVerifiedServerFilm}>Recover server-authorised film</button>'+
  '<button type="button" onClick={requestVerifiedServerEditing}>Request verified editing</button>'+
  '<output aria-label="Native server continuity state">{__continuityView?.mode||"none"} | {__continuityView?.projectId||"none"} | {__continuityView?.writable?"writable":"blocked"}</output>');
 assert.equal(changed.split('Recover movie preview').length,2);
 assert.equal(changed.split('Recover server-authorised film').length,2);
 assert.equal(changed.split('Request verified editing').length,2);
 return changed;
}
