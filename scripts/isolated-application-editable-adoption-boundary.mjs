// Diagnostic application editable-adoption boundary.
// Read-only recovery is evidence, NOT a writer grant. Server-issued provenance
// grant and fresh owner-authenticated fenced admission are independently required.
export function createIsolatedApplicationEditableAdoption({readSelected,readProject,issueGrant,admit,readAdmission,onVerifiedEditable}={}){
 if([readSelected,readProject,issueGrant,admit,readAdmission,onVerifiedEditable].some(x=>typeof x!=='function'))
  throw Error('application-editable-authority-required');
 let epoch=0,active=null;
 const snap=()=>active?structuredClone(active):null;
 const good=x=>Number.isSafeInteger(x)&&x>=0;
 async function activate({token,selectionVaultId,readOnlySnapshot,operationId}={}){
  const version=++epoch;
  if(!token||!operationId||!readOnlySnapshot?.readOnly||readOnlySnapshot?.writable!==false||
    !readOnlySnapshot?.projectId||readOnlySnapshot.selectionVaultId!==selectionVaultId||
    !good(readOnlySnapshot.selectionRevision)||!good(readOnlySnapshot.projectRevision))
   return {ok:false,reason:'read-only-evidence-required'};
  const projectId=readOnlySnapshot.projectId;
  const stillCurrent=()=>version===epoch;
  const failed=reason=>({ok:false,reason});
  try{
   const selected=await readSelected({token,projectId:selectionVaultId});
   if(!stillCurrent())return failed('stale-request');
   if(selected?.ok!==true||selected.projectId!==selectionVaultId||
      selected.activeProjectId!==projectId||selected.revision!==readOnlySnapshot.selectionRevision)
    return failed('selection-unverified');
   const project=await readProject({token,projectId});
   if(!stillCurrent())return failed('stale-request');
   if(project?.ok!==true||project.projectId!==projectId||project.revision!==readOnlySnapshot.projectRevision||
      !Array.isArray(project.state?.scenes)||
      JSON.stringify(project.state.scenes)!==JSON.stringify(readOnlySnapshot.scenes))
    return failed('durable-project-changed');
   // Grant issuance is exclusively server-owned and must verify canonical
   // publication ledger. A local read-only snapshot never generates a grant.
   const issued=await issueGrant({token,projectId,revision:project.revision});
   if(!stillCurrent())return failed('stale-request');
   if(!issued?.grantId||issued.projectId!==projectId||issued.revision!==project.revision)
    return failed('publication-grant-denied');
   const admitted=await admit({token,projectId,grantId:issued.grantId,operationId,revision:project.revision});
   if(!stillCurrent())return failed('stale-request');
   if(admitted?.acquired!==true||admitted.projectId!==projectId||
      admitted.operationId!==operationId||admitted.revision!==project.revision||!admitted.fence)
    return failed('writable-admission-denied');
   const receipt=await readAdmission({token,projectId,operationId,fence:admitted.fence});
   if(!stillCurrent())return failed('stale-request');
   if(!receipt||receipt.projectId!==projectId||receipt.operationId!==operationId||
      receipt.revision!==admitted.revision||receipt.fence!==admitted.fence)
    return failed('admission-readback-denied');
   const lastSelection=await readSelected({token,projectId:selectionVaultId});
   if(!stillCurrent())return failed('stale-request');
   if(lastSelection?.ok!==true||lastSelection.projectId!==selectionVaultId||
      lastSelection.activeProjectId!==projectId||
      lastSelection.revision!==readOnlySnapshot.selectionRevision)
    return failed('selection-changed');
   active={projectId,selectionVaultId,selectionRevision:lastSelection.revision,
     revision:receipt.revision,operationId,fence:receipt.fence,writable:true,serverOwned:true};
   onVerifiedEditable(snap());
   return {ok:true,adoption:snap()};
  }catch{return failed('authority-unavailable')}
 }
 return Object.freeze({activate,getSnapshot:snap,invalidate:()=>{epoch++;active=null}});
}
