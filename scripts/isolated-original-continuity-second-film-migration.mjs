// Replacement *caller* for the obsolete local second-film selection block.
// This is a diagnostic frontend migration candidate, NOT an authority to
// rebase a restarted CreatorMemory or a change to the original regression.
export async function selectSecondFilmWithServerAuthority({
 coordinator, token, selectionVaultId, nextProjectId, selectionOperationId,
 localMemory, originalBytes, getLocalBytes
}={}){
 if(!coordinator||!token||!selectionVaultId||!nextProjectId||
    !selectionOperationId||typeof getLocalBytes!=='function'||
    !localMemory||typeof localMemory.getState!=='function')
  return Object.freeze({ok:false,reason:'migration-dependencies-unavailable'});
 const unchanged=()=>getLocalBytes()===originalBytes;
 if(!unchanged())return Object.freeze({ok:false,reason:'local-memory-changed'});
 try{
  const opened=await coordinator.open({token,selectionVaultId});
  if(!opened?.ok||!opened.view?.projectId||!unchanged())
   return Object.freeze({ok:false,reason:'selection-unverified'});
  if(opened.view.projectId===nextProjectId)
   return Object.freeze({ok:false,reason:'distinct-second-film-required'});
  const changed=await coordinator.switchFilm({token,selectionVaultId,
    operationId:selectionOperationId,nextProjectId});
  if(!changed?.ok||changed.view?.projectId!==nextProjectId||
     changed.view?.writable!==false||!unchanged())
   return Object.freeze({ok:false,reason:'second-film-selection-denied'});
  const recovered=await coordinator.recover({token,selectionVaultId});
  if(!recovered?.ok||recovered.view?.mode!=='read-only'||
     recovered.view?.projectId!==nextProjectId||
     recovered.view?.writable!==false||!Array.isArray(recovered.view.scenes)||
     !unchanged())
   return Object.freeze({ok:false,reason:'second-film-recovery-denied'});
  // A newly selected film is read-only, never a local writer grant.
  return Object.freeze({ok:true,projectId:nextProjectId,
    mode:'read-only',writable:false,
    scenes:structuredClone(recovered.view.scenes),
    selectionRevision:recovered.view.selectionRevision});
 }catch{return Object.freeze({ok:false,reason:'server-authority-unavailable'})}
}
