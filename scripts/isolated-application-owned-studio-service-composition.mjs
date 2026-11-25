// Isolated candidate for application-owned Studio service composition.
// Transport and identity are injected; no token, storage, or authority is
// created from diagnostic globals. NOT a production application adoption.
import {createIsolatedStudioServerSelectionAdoption} from './isolated-studio-server-selection-adoption.mjs';
import {createIsolatedApplicationRecoveryAdoption} from './isolated-application-recovery-adoption-boundary.mjs';
import {createIsolatedApplicationEditableAdoption} from './isolated-application-editable-adoption-boundary.mjs';
import {createIsolatedStudioContinuityMigration} from './isolated-studio-continuity-migration-candidate.mjs';
import {createApplicationSecondFilmBoundary} from './isolated-application-owned-second-film-boundary.mjs';
import {selectSecondFilmWithServerAuthority} from './isolated-original-continuity-second-film-migration.mjs';

export function createApplicationOwnedStudioServices({
  transport,getToken,selectionVaultId,readLocalBytes,
  onSelection=()=>{},onReadOnly=()=>{},onEditable=()=>{},onView=()=>{}
}={}){
 if(typeof transport!=='function'||typeof getToken!=='function'||
    typeof selectionVaultId!=='string'||!selectionVaultId.trim()||
    typeof readLocalBytes!=='function'||
    [onSelection,onReadOnly,onEditable,onView].some(f=>typeof f!=='function'))
  throw Error('application-studio-service-dependencies-required');
 const snapshotToken=()=>{
  const token=getToken();
  if(typeof token!=='string'||!token.trim())throw Error('owner-token-unavailable');
  return token;
 };
 const execute=(path,data={})=>{
  const token=data.token??snapshotToken();
  if(typeof token!=='string'||!token.trim())throw Error('owner-token-unavailable');
  const {token:_ignored,...body}=data;
  return transport({path,token,body});
 };
 const selection=createIsolatedStudioServerSelectionAdoption({
  authority:{read:x=>execute('/studio/selection-read',x),
    select:x=>execute('/studio/selection-change',x)},
  onCommitted:onSelection
 });
 const readSelected=x=>execute('/studio/selection-read',x);
 const readProject=x=>execute('/studio/read',x);
 const recovery=createIsolatedApplicationRecoveryAdoption({
  readSelected,readProject,onVerifiedReadOnly:onReadOnly
 });
 const editable=createIsolatedApplicationEditableAdoption({
  readSelected,readProject,
  issueGrant:x=>execute('/studio/publication-grant',x),
  admit:x=>execute('/studio/admit-publication',x),
  readAdmission:x=>execute('/studio/read-admission',x),
  onVerifiedEditable:onEditable
 });
 const continuity=createIsolatedStudioContinuityMigration({selection,recovery,editable,onView});
 const applicationSecondFilm=createApplicationSecondFilmBoundary({
  continuity,selectSecondFilm:selectSecondFilmWithServerAuthority,
  readLocalBytes,onReadOnly,
  // Editing projection can arrive from both the canonical admission receipt
  // (revision) and the continuity view (projectRevision). Preserve the
  // verified server revision in the UI-facing shape; never mint permission.
  onEditable:view=>{
   if(view===null){onEditable(null);return;}
   if(view.serverOwned!==true||view.writable!==true||!view.fence||
      !Number.isSafeInteger(view.projectRevision))return;
   onEditable({...view,revision:view.projectRevision});
  }
 });
 // Pending turn lives with the application service instance, not on window.
 let pending=null;
 let creationEpoch=0,creating=false;
 // The caller retains the canonical identity across ambiguous HTTP outcomes.
 async function createNativeFilm({projectId,operationId}={}){
  if(creating||typeof projectId!=='string'||!/^movie-project-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId)||typeof operationId!=='string'||!operationId.trim())return {ok:false,reason:'native-creation-input-denied'};
  creating=true;const epoch=++creationEpoch;
  try{
   const token=snapshotToken(),bytes=readLocalBytes();
   if(typeof bytes!=='string')return {ok:false,reason:'local-memory-unavailable'};
   const current=()=>epoch===creationEpoch&&readLocalBytes()===bytes&&snapshotToken()===token;
   applicationSecondFilm.invalidate();continuity.invalidate();pending=null;
   const identity={domain:'iband.movie-mentor.project',schema:1,issuance:'secure-web-crypto',legacy:false};
   const created=await execute('/api/movie-mentor/projects',{token,projectId,identity});
   if(!current()||created?.success!==true||created.projectId!==projectId||created.ownership?.projectId!==projectId||created.ownership?.status!=='active')return {ok:false,reason:'native-ownership-unverified'};
   const registered=await execute('/studio/native-film-register',{token,projectId});
   if(!current()||registered?.ok!==true||registered.projectId!==projectId)return {ok:false,reason:'native-registration-unverified'};
   const loaded=await selection.load({token,projectId:selectionVaultId});
   if(!current()||!loaded.ok)return {ok:false,reason:'selection-unverified'};
   if(loaded.selection.activeProjectId!==projectId){
    const changed=await selection.change({token,projectId:selectionVaultId,operationId,nextActiveProjectId:projectId});
    if(!current()||!changed.ok)return {ok:false,reason:'native-selection-unverified'};
   }
   const recovered=await applicationSecondFilm.reopen({token,selectionVaultId,projectId});
   if(!current()||!recovered.ok||recovered.view?.projectId!==projectId||recovered.view?.writable!==false)return {ok:false,reason:'native-recovery-unverified'};
   return {ok:true,projectId,view:recovered.view};
  }catch{return {ok:false,reason:'native-creation-outcome-unverified'}}finally{creating=false}
 }
 let submitting=false;
 async function submitNativeConversation({creatorMessage,mentorMessage}={}){
  const admitted=editable.getSnapshot(),selected=selection.getSnapshot();
  if(submitting||!admitted?.writable||selected?.activeProjectId!==admitted.projectId||selected.revision!==admitted.selectionRevision||!creatorMessage?.id)return {ok:false,reason:'native-writer-required'};
  submitting=true;
  const projectId=admitted.projectId,operationId=admitted.operationId+':'+creatorMessage.id;
  const current=()=>{const e=editable.getSnapshot(),s=selection.getSnapshot();return e?.fence===admitted.fence&&s?.activeProjectId===projectId&&s.revision===admitted.selectionRevision};
  try{
   const token=snapshotToken();
   const body={token,projectId,selectionVaultId,operationId,creatorTurnId:creatorMessage.id,expectedRevision:admitted.revision,fence:admitted.fence,creatorMessage,mentorMessage};
   const settled=await execute('/studio/native-conversation-settle',body);
   if(!current()||settled?.ok!==true||settled.projectId!==projectId||settled.operationId!==operationId||settled.creatorTurnId!==creatorMessage.id||settled.committedRevision!==admitted.revision+1||!settled.serverCommitId)return {ok:false,reason:'settlement-unverified'};
   const receipt=await execute('/studio/native-conversation-receipt',{token,projectId,operationId});
   if(!current()||receipt?.ok!==true||receipt.projectId!==projectId||receipt.operationId!==operationId||receipt.creatorTurnId!==creatorMessage.id||receipt.committedRevision!==settled.committedRevision||receipt.serverCommitId!==settled.serverCommitId)return {ok:false,reason:'receipt-unverified'};
   const recovered=await applicationSecondFilm.reopen({token,selectionVaultId,projectId});
   if(!recovered.ok||recovered.view?.projectRevision!==receipt.committedRevision||!Array.isArray(recovered.view.conversationMessages)||JSON.stringify(recovered.view.conversationMessages.slice(-2))!==JSON.stringify([creatorMessage,mentorMessage]))return {ok:false,reason:'conversation-readback-unverified'};
   return {ok:true,view:recovered.view,receipt};
  }catch{return {ok:false,reason:'native-settlement-outcome-unverified'}}finally{submitting=false}
 }
 const studioServices={
  editable,selection,
  request:(path,body)=>execute(path,body),
  get pending(){return pending},
  set pending(value){pending=value}
 };
 const recoveryServices=()=>({
  continuity,token:snapshotToken(),selectionVaultId
 });
 const invalidate=()=>{
  creationEpoch++;pending=null;applicationSecondFilm.invalidate();continuity.invalidate();
 };
 return Object.freeze({
  studioServices,applicationSecondFilm,recoveryServices,createNativeFilm,submitNativeConversation,
  getSelection:()=>selection.getSnapshot(),getContinuity:()=>continuity.getSnapshot(),
  invalidate
 });
}
