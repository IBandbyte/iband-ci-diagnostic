// Diagnostic-only bridge from pinned Studio's read-only recovery selector
// to server-owned active-project selection. It never writes CreatorMemory.
export function createIsolatedStudioServerSelectionAdoption({authority,onCommitted}={}){
 if(typeof authority?.read!=='function'||typeof authority?.select!=='function'||typeof onCommitted!=='function')
  throw Error('studio-selection-authority-required');
 let generation=0,selection=null;
 const valid=x=>x&&typeof x.projectId==='string'&&x.projectId.length>0&&
  Number.isSafeInteger(x.revision)&&x.revision>=0;
 const snapshot=()=>selection?structuredClone(selection):null;
 async function load({token,projectId}={}){
  const current=++generation;
  let result;
  try{result=await authority.read({token,projectId})}catch{return {ok:false,reason:'read-unavailable'}}
  if(current!==generation)return {ok:false,reason:'stale-selection'};
  if(result?.ok!==true||!valid(result)||result.projectId!==projectId||
     (result.activeProjectId!==null&&typeof result.activeProjectId!=='string'))
   return {ok:false,reason:'read-unverified'};
  selection={...result};
  onCommitted(snapshot());
  return {ok:true,selection:snapshot()};
 }
 async function change({token,projectId,operationId,nextActiveProjectId}={}){
  if(!selection||selection.projectId!==projectId||typeof operationId!=='string'||!operationId.trim()||
     !(nextActiveProjectId===null||(typeof nextActiveProjectId==='string'&&nextActiveProjectId.trim())))
   return {ok:false,reason:'selection-not-ready'};
  const current=++generation,expectedRevision=selection.revision;
  let receipt;
  try{receipt=await authority.select({token,projectId,operationId,nextActiveProjectId,expectedRevision})}
  catch{return {ok:false,reason:'outcome-unknown'}}
  if(current!==generation)return {ok:false,reason:'stale-selection'};
  if(receipt?.ok!==true||receipt.receipt?.projectId!==projectId||
     receipt.receipt?.operationId!==operationId||
     receipt.receipt?.committedRevision!==expectedRevision+1||
     typeof receipt.receipt?.serverCommitId!=='string'||!receipt.receipt.serverCommitId)
   return {ok:false,reason:'receipt-unverified'};
  let remote;
  try{remote=await authority.read({token,projectId})}catch{return {ok:false,reason:'readback-unavailable'}}
  if(current!==generation)return {ok:false,reason:'stale-selection'};
  if(remote?.ok!==true||remote.projectId!==projectId||
     remote.revision!==receipt.receipt.committedRevision||
     remote.activeProjectId!==nextActiveProjectId)
   return {ok:false,reason:'readback-unverified'};
  selection={...remote};
  onCommitted(snapshot());
  return {ok:true,selection:snapshot(),serverCommitId:receipt.receipt.serverCommitId};
 }
 return Object.freeze({load,change,getSnapshot:snapshot,invalidate:()=>{generation++;selection=null}});
}
