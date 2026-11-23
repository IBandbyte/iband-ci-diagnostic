// Application-owned, dependency-injected second-film boundary candidate.
// This does not mutate CreatorMemory or grant editing from a recovered preview.
// No global diagnostic hooks, application-main modifications, or production I/O.
export function createApplicationSecondFilmBoundary({
  continuity,selectSecondFilm,readLocalBytes,onReadOnly,onEditable
}={}){
  if(!continuity||['open','recover','requestEditing','getSnapshot'].some(
    key=>typeof continuity[key]!=='function')||
    typeof selectSecondFilm!=='function'||typeof readLocalBytes!=='function'||
    typeof onReadOnly!=='function'||typeof onEditable!=='function')
    throw Error('application-second-film-dependencies-required');
  let epoch=0,readonly=null,editable=null;
  const copy=x=>x?structuredClone(x):null;
  const invalidate=()=>{epoch++;readonly=null;editable=null;onReadOnly(null);onEditable(null)};
  async function choose({token,selectionVaultId,nextProjectId,selectionOperationId,localMemory}={}){
    invalidate();
    const my=epoch;
    if(!token||!selectionVaultId||!nextProjectId||!selectionOperationId||
       typeof localMemory?.getState!=='function')
      return {ok:false,reason:'selection-input-required'};
    const bytes=readLocalBytes();
    if(typeof bytes!=='string')return {ok:false,reason:'local-memory-unavailable'};
    try{
      const opened=await continuity.open({token,selectionVaultId});
      if(my!==epoch)return {ok:false,reason:'stale-selection'};
      if(opened?.ok!==true||opened.view?.projectId===nextProjectId||
         readLocalBytes()!==bytes)
        return {ok:false,reason:'selection-unverified'};
      const switched=await selectSecondFilm({
        coordinator:continuity,token,selectionVaultId,nextProjectId,
        selectionOperationId,localMemory,originalBytes:bytes,
        getLocalBytes:readLocalBytes
      });
      if(my!==epoch)return {ok:false,reason:'stale-selection'};
      if(switched?.ok!==true||switched.projectId!==nextProjectId||
         switched.mode!=='read-only'||switched.writable!==false||
         readLocalBytes()!==bytes)return {ok:false,reason:'read-only-selection-denied'};
      const view=continuity.getSnapshot();
      if(view?.projectId!==nextProjectId||view.mode!=='read-only'||
         view.writable!==false)return {ok:false,reason:'read-only-view-unverified'};
      readonly=copy(view);
      onReadOnly(copy(readonly));
      return {ok:true,view:copy(readonly)};
    }catch{return {ok:false,reason:'selection-authority-unavailable'}}
  }
  async function reopen({token,selectionVaultId,projectId}={}){
    invalidate();
    const my=epoch,bytes=readLocalBytes();
    if(!token||!selectionVaultId||!projectId||typeof bytes!=='string')
      return {ok:false,reason:'recovery-input-required'};
    try{
      const opened=await continuity.open({token,selectionVaultId});
      if(my!==epoch)return {ok:false,reason:'stale-recovery'};
      if(opened?.ok!==true||opened.view?.projectId!==projectId||
         readLocalBytes()!==bytes)return {ok:false,reason:'selected-film-unverified'};
      const recovered=await continuity.recover({token,selectionVaultId});
      if(my!==epoch)return {ok:false,reason:'stale-recovery'};
      if(recovered?.ok!==true||recovered.view?.projectId!==projectId||
         recovered.view?.mode!=='read-only'||recovered.view?.writable!==false||
         readLocalBytes()!==bytes)return {ok:false,reason:'recovery-denied'};
      readonly=copy(recovered.view);
      onReadOnly(copy(readonly));
      return {ok:true,view:copy(readonly)};
    }catch{return {ok:false,reason:'recovery-authority-unavailable'}}
  }
  async function requestEditing({token,selectionVaultId,operationId}={}){
    const my=epoch,proof=copy(readonly);
    if(!proof||proof.mode!=='read-only'||proof.writable!==false||
       !token||!selectionVaultId||!operationId)
      return {ok:false,reason:'read-only-proof-required'};
    try{
      const result=await continuity.requestEditing({token,selectionVaultId,operationId});
      if(my!==epoch)return {ok:false,reason:'stale-admission'};
      if(result?.ok!==true||result.view?.projectId!==proof.projectId||
         result.view?.mode!=='server-editable'||result.view?.writable!==true||
         result.view?.serverOwned!==true||!result.view?.fence||
         result.view?.operationId!==operationId)
        return {ok:false,reason:'fenced-admission-denied'};
      editable=copy(result.view);
      onEditable(copy(editable));
      return {ok:true,view:copy(editable)};
    }catch{return {ok:false,reason:'editing-authority-unavailable'}}
  }
  return Object.freeze({choose,reopen,requestEditing,invalidate,
    getReadOnly:()=>copy(readonly),getEditable:()=>copy(editable)});
}
