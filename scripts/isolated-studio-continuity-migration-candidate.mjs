// Source-anchored candidate for CreatorWorkspace continuity migration.
// Composes separately certified server-selection, recovery and admission seams.
// Never changes local CreatorMemory or treats an active-project display as authority.
export function createIsolatedStudioContinuityMigration({selection,recovery,editable,onView}={}){
 if(!selection||!recovery||!editable||typeof onView!=='function'||
  ['load','change','getSnapshot','invalidate'].some(k=>typeof selection[k]!=='function')||
  ['inspect','getSnapshot','invalidate'].some(k=>typeof recovery[k]!=='function')||
  ['activate','getSnapshot','invalidate'].some(k=>typeof editable[k]!=='function'))
  throw Error('continuity-migration-authorities-required');
 let generation=0,view=null;
 const snapshot=()=>view?structuredClone(view):null;
 const publish=x=>{view=structuredClone(x);onView(snapshot());return snapshot()};
 const deny=reason=>({ok:false,reason});
 function reset(){generation++;selection.invalidate();recovery.invalidate();editable.invalidate();view=null;onView(null)}
 async function open({token,selectionVaultId}={}){
  const n=++generation;
  editable.invalidate();recovery.invalidate();
  publish({mode:'blocked',projectId:null,writable:false});
  const result=await selection.load({token,projectId:selectionVaultId});
  if(n!==generation)return deny('stale-open');
  if(!result?.ok||!result.selection?.activeProjectId)return deny('server-selection-unverified');
  publish({mode:'selection-verified',projectId:result.selection.activeProjectId,
   selectionRevision:result.selection.revision,writable:false});
  return {ok:true,view:snapshot()};
 }
 async function switchFilm({token,selectionVaultId,operationId,nextProjectId}={}){
  const n=++generation;
  // Previous editor fence must not survive film change, even if server denies it.
  editable.invalidate();recovery.invalidate();
  publish({mode:'blocked',projectId:null,writable:false});
  const result=await selection.change({token,projectId:selectionVaultId,operationId,nextActiveProjectId:nextProjectId});
  if(n!==generation)return deny('stale-switch');
  if(!result?.ok||result.selection?.activeProjectId!==nextProjectId)return deny('selection-denied');
  publish({mode:'selection-verified',projectId:nextProjectId,
   selectionRevision:result.selection.revision,writable:false});
  return {ok:true,view:snapshot()};
 }
 async function recover({token,selectionVaultId}={}){
  const current=selection.getSnapshot();
  const n=++generation;
  editable.invalidate();recovery.invalidate();
  if(!current?.activeProjectId||view?.projectId!==current.activeProjectId||
    view?.selectionRevision!==current.revision){
    publish({mode:'blocked',projectId:null,writable:false});
    return deny('selection-unverified');
  }
  publish({mode:'recovering',projectId:current.activeProjectId,writable:false});
  const result=await recovery.inspect({token,selectionVaultId,projectId:current.activeProjectId});
  if(n!==generation)return deny('stale-recovery');
  if(!result?.ok||result.snapshot?.projectId!==current.activeProjectId||
    result.snapshot.selectionRevision!==current.revision||
    result.snapshot.writable!==false||result.snapshot.readOnly!==true)
    return deny('durable-recovery-unverified');
  publish({mode:'read-only',projectId:current.activeProjectId,selectionRevision:current.revision,
   projectRevision:result.snapshot.projectRevision,scenes:result.snapshot.scenes,...(result.snapshot.conversationMessages===undefined?{}:{conversationMessages:result.snapshot.conversationMessages}),writable:false});
  return {ok:true,view:snapshot()};
 }
 async function requestEditing({token,selectionVaultId,operationId}={}){
  const readonly=recovery.getSnapshot();
  const current=selection.getSnapshot();
  const n=++generation;
  editable.invalidate();
  if(view?.mode!=='read-only'||!readonly?.readOnly||readonly.writable!==false||
   view.projectId!==readonly.projectId||current?.activeProjectId!==readonly.projectId||
   current.revision!==readonly.selectionRevision){
   publish({mode:'blocked',projectId:null,writable:false});
   return deny('read-only-proof-required');
  }
  const result=await editable.activate({token,selectionVaultId,readOnlySnapshot:readonly,operationId});
  if(n!==generation)return deny('stale-admission');
  const after=selection.getSnapshot();
  if(!result?.ok||!result.adoption?.serverOwned||!result.adoption.writable||
   result.adoption.projectId!==readonly.projectId||result.adoption.selectionRevision!==readonly.selectionRevision||
   after?.activeProjectId!==readonly.projectId||after.revision!==readonly.selectionRevision){
   editable.invalidate();
   publish({mode:'read-only',projectId:readonly.projectId,selectionRevision:readonly.selectionRevision,
     projectRevision:readonly.projectRevision,scenes:readonly.scenes,...(readonly.conversationMessages===undefined?{}:{conversationMessages:readonly.conversationMessages}),writable:false});
   return deny('admission-unverified');
  }
  publish({mode:'server-editable',projectId:readonly.projectId,selectionRevision:readonly.selectionRevision,
   projectRevision:readonly.projectRevision,scenes:readonly.scenes,...(readonly.conversationMessages===undefined?{}:{conversationMessages:readonly.conversationMessages}),operationId:result.adoption.operationId,
   fence:result.adoption.fence,writable:true,serverOwned:true});
  return {ok:true,view:snapshot()};
 }
 return Object.freeze({open,switchFilm,recover,requestEditing,getSnapshot:snapshot,invalidate:reset});
}
