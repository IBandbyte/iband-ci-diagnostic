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
  pending=null;applicationSecondFilm.invalidate();continuity.invalidate();
 };
 return Object.freeze({
  studioServices,applicationSecondFilm,recoveryServices,
  getSelection:()=>selection.getSnapshot(),getContinuity:()=>continuity.getSnapshot(),
  invalidate
 });
}
