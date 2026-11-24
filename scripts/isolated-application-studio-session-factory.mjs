// Diagnostic application-owned composition candidate. No ambient identity,
// network destination or browser storage is trusted. The server must verify
// the explicitly resolved selection-vault identity before services escape.
import {createAsyncAuthenticatedStudioSession} from './isolated-application-studio-async-clerk-session-adapter.mjs';
export function createApplicationStudioSessionFactory({transport,resolveSelectionVaultId,readLocalBytes,onSelection=()=>{},onReadOnly=()=>{},onEditable=()=>{},onView=()=>{}}={}){
 if([transport,resolveSelectionVaultId,readLocalBytes,onSelection,onReadOnly,onEditable,onView].some(x=>typeof x!=='function'))
  throw Error('application-studio-factory-dependencies-required');
 return function createSession({getAuthToken,onAuthInvalidated=()=>{}}={}){
  if(typeof getAuthToken!=='function'||typeof onAuthInvalidated!=='function')throw Error('application-studio-auth-required');
  let epoch=0,inner=null,ready=null;
  function invalidate(){epoch++;ready=null;const prior=inner;inner=null;prior?.invalidate();}
  async function open(){
   invalidate();const own=epoch;
   const current=()=>own===epoch;
   try{
    const token=await getAuthToken();
    if(!current())return {ok:false,reason:'stale-authentication'};
    if(typeof token!=='string'||!token||token.trim()!==token)return {ok:false,reason:'authenticated-token-unavailable'};
    const id=await resolveSelectionVaultId({token});
    if(!current())return {ok:false,reason:'stale-authentication'};
    if(typeof id!=='string'||!id||id.trim()!==id)return {ok:false,reason:'selection-vault-unavailable'};
    const candidate=createAsyncAuthenticatedStudioSession({
     getAuthToken,transport,selectionVaultId:id,readLocalBytes,onSelection,onReadOnly,onEditable,onView,
     onAuthInvalidated:reason=>{if(current()){invalidate();onAuthInvalidated(reason)}}
    });
    inner=candidate;
    const opened=await candidate.open();
    if(!current())return {ok:false,reason:'stale-authentication'};
    if(!opened.ok||opened.services.recoveryServices().token!==token){invalidate();return {ok:false,reason:'selection-vault-session-changed'}}
    const proof=await opened.services.studioServices.request('/studio/selection-read',{projectId:id});
    if(!current())return {ok:false,reason:'stale-authentication'};
    if(proof?.ok!==true||proof.projectId!==id||!Number.isSafeInteger(proof.revision)||proof.revision<0||
       !(proof.activeProjectId===null||(typeof proof.activeProjectId==='string'&&proof.activeProjectId.trim()))){
     invalidate();return {ok:false,reason:'selection-vault-unverified'};
    }
    ready=opened.services;
    return {ok:true,services:ready};
   }catch{
    if(!current())return {ok:false,reason:'stale-authentication'};
    invalidate();return {ok:false,reason:'selection-vault-unverified'};
   }
  }
  return Object.freeze({open,invalidate,getServices:()=>ready});
 };
}
