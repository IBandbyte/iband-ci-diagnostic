// Diagnostic-only lifecycle handoff. This is NOT installed in application Studio.
// Server owns writable admission, receipt and publication; this client view remains
// read-only until the server confirms a result for the currently selected project.
export function createIsolatedStudioLifecycleCoordinator({authority,view}={}){
 if(!authority||typeof authority.readProject!=='function'||typeof authority.admit!=='function'||typeof authority.saveScene!=='function'||typeof authority.readCommitted!=='function'||!view)return null;
 let active=null,epoch=0,admission=null,pending=null,committed=null;
 const sameSelection=(projectId,version)=>active===projectId&&epoch===version;
 const notify=()=>view({projectId:active,phase:admission?'writable':committed?'read-only':'blocked',pending:pending?structuredClone(pending):null,committed:committed?structuredClone(committed):null});
 async function select(projectId){
  if(typeof projectId!=='string'||!projectId.trim())return {ok:false,reason:'missing-project'};
  active=projectId;epoch++;admission=null;pending=null;committed=null;
  const version=epoch;notify();
  const result=await authority.readProject(projectId);
  if(!sameSelection(projectId,version))return {ok:false,reason:'stale-project-selection'};
  if(!result?.ok||result.projectId!==projectId||!Number.isSafeInteger(result.revision)||!result.state)return {ok:false,reason:'read-denied'};
  committed={projectId,revision:result.revision,state:structuredClone(result.state)};
  notify();return {ok:true,mode:'read-only',revision:result.revision};
 }
 async function requestWritable({operationId}={}){
  if(!committed||!active||!operationId||pending)return {ok:false,reason:'not-admissible'};
  const projectId=active,version=epoch,revision=committed.revision;
  const issued=await authority.admit({projectId,operationId,expectedRevision:revision});
  if(!sameSelection(projectId,version))return {ok:false,reason:'stale-project-selection'};
  if(!issued?.ok||issued.projectId!==projectId||issued.revision!==revision||!issued.fence)return {ok:false,reason:'admission-denied'};
  admission={projectId,revision,fence:issued.fence,operationId};
  notify();return {ok:true,revision,fence:issued.fence};
 }
 async function saveScene({operationId,scene}={}){
  if(!active||!admission||!committed||pending)return {ok:false,reason:'not-writable'};
  if(!operationId?.startsWith(admission.operationId+':')||!scene?.id||typeof scene.text!=='string')return {ok:false,reason:'invalid-scene'};
  const projectId=active,version=epoch,priorRevision=committed.revision;
  pending={operationId,scene:structuredClone(scene),projectId};notify();
  let result;
  try{result=await authority.saveScene({projectId,operationId,expectedRevision:priorRevision,fence:admission.fence,scene:structuredClone(scene)});}
  catch{if(sameSelection(projectId,version))notify();return {ok:false,reason:'outcome-unknown'};}
  if(!sameSelection(projectId,version))return {ok:false,reason:'stale-project-selection'};
  if(!result?.ok||result.projectId!==projectId||result.operationId!==operationId||result.committedRevision!==priorRevision+1||!result.serverCommitId)return {ok:false,reason:'receipt-unverified'};
  let readback;
  try{readback=await authority.readCommitted({projectId,operationId});}
  catch{return {ok:false,reason:'readback-unknown'};}
  if(!sameSelection(projectId,version))return {ok:false,reason:'stale-project-selection'};
  if(!readback?.ok||readback.projectId!==projectId||readback.operationId!==operationId||
     readback.revision!==result.committedRevision||readback.serverCommitId!==result.serverCommitId||
     !readback.state?.scenes?.some(s=>s.id===scene.id&&s.text===scene.text))return {ok:false,reason:'readback-unverified'};
  committed={projectId,revision:readback.revision,state:structuredClone(readback.state)};
  pending=null;admission.revision=committed.revision;notify();
  return {ok:true,revision:committed.revision};
 }
 return Object.freeze({select,requestWritable,saveScene,getSnapshot:()=>({active,epoch,admission:admission?{...admission}:null,pending:pending?structuredClone(pending):null,committed:committed?structuredClone(committed):null})});
}
