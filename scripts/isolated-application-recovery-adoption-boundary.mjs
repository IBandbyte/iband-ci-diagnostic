// Application-facing adoption boundary candidate for the pinned CreatorWorkspace.
// Diagnostic only: an authenticated server read is evidence for a controlled
// read-only presentation, NEVER a CreatorMemory write or writable admission.
// Activation remains fail-closed until an independent physical migration court.
export function createIsolatedApplicationRecoveryAdoption({readSelected,readProject,onVerifiedReadOnly}={}) {
 if(typeof readSelected!=='function'||typeof readProject!=='function'||typeof onVerifiedReadOnly!=='function')
  throw Error('server-read-adoption-dependencies-required');
 let generation=0;
 let current=null;
 const snapshot=()=>current?structuredClone(current):null;
 const validId=x=>typeof x==='string'&&x.length>0&&x.trim()===x;
 const validRev=x=>Number.isSafeInteger(x)&&x>=0;
 async function inspect({token,selectionVaultId,projectId}={}){
  const my=++generation;
  if(!token||!validId(selectionVaultId)||!validId(projectId))return {ok:false,reason:'invalid-request'};
  let selection,project;
  try {
   selection=await readSelected({token,projectId:selectionVaultId});
   if(generation!==my)return {ok:false,reason:'stale-request'};
   if(selection?.ok!==true||selection.projectId!==selectionVaultId||selection.activeProjectId!==projectId||!validRev(selection.revision))
    return {ok:false,reason:'selection-unverified'};
   project=await readProject({token,projectId});
  }catch{return {ok:false,reason:'server-unavailable'}}
  if(generation!==my)return {ok:false,reason:'stale-request'};
  if(project?.ok!==true||project.projectId!==projectId||!validRev(project.revision)||
     !project.state||!Array.isArray(project.state.scenes)||
     project.state.scenes.some(s=>!validId(s?.id)||typeof s.text!=='string'))
   return {ok:false,reason:'project-unverified'};
  // Legacy scene-only responses remain compatible; native history is never silently discarded.
  const messages=project.state.conversationMessages;
  if(messages!==undefined){
   if(!Array.isArray(messages)||messages.length%2!==0)return {ok:false,reason:'conversation-unverified'};
   const ids=new Set();
   for(let i=0;i<messages.length;i+=2){
    const c=messages[i],m=messages[i+1];
    if(c?.role!=='creator'||m?.role!=='mentor'||typeof c.text!=='string'||typeof m.text!=='string')return {ok:false,reason:'conversation-unverified'};
    // Historical imported pairs may lack IDs; do not invent them.
    if(c.id!==undefined||m.id!==undefined){
     if(!validId(c.id)||!validId(m.id)||c.id===m.id||ids.has(c.id)||ids.has(m.id)||m.metadata?.backendMetadata?.creatorTurnId!==c.id)return {ok:false,reason:'conversation-unverified'};
     ids.add(c.id);ids.add(m.id);
    }
   }
  }
  // An authenticated re-read guards selection changes between the two reads.
  let second;
  try{second=await readSelected({token,projectId:selectionVaultId})}catch{return {ok:false,reason:'selection-recheck-unavailable'}}
  if(generation!==my)return {ok:false,reason:'stale-request'};
  if(second?.ok!==true||second.projectId!==selectionVaultId||second.activeProjectId!==projectId||
    second.revision!==selection.revision)return {ok:false,reason:'selection-changed'};
  current={selectionVaultId,projectId,selectionRevision:selection.revision,projectRevision:project.revision,
    scenes:structuredClone(project.state.scenes),...(messages===undefined?{}:{conversationMessages:structuredClone(messages)}),readOnly:true,writable:false};
  onVerifiedReadOnly(snapshot());
  return {ok:true,mode:'read-only',snapshot:snapshot()};
 }
 return Object.freeze({inspect,getSnapshot:snapshot,invalidate(){generation++;current=null}});
}
