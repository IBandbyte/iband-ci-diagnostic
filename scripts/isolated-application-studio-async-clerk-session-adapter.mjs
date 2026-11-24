// Async authenticated Studio session adapter. Diagnostic-only candidate.
// Resolve actual Clerk token BEFORE composing the synchronous Studio authority
// boundary. Reject rotated/invalid session tokens before EVERY network request.
import {createApplicationOwnedStudioServices} from './isolated-application-owned-studio-service-composition.mjs';
export function createAsyncAuthenticatedStudioSession({
  getAuthToken,transport,selectionVaultId,readLocalBytes,
  onSelection=()=>{},onReadOnly=()=>{},onEditable=()=>{},onView=()=>{}
}={}){
 if(typeof getAuthToken!=='function'||typeof transport!=='function'||
    typeof selectionVaultId!=='string'||!selectionVaultId.trim()||
    typeof readLocalBytes!=='function'||
    [onSelection,onReadOnly,onEditable,onView].some(x=>typeof x!=='function'))
  throw Error('async-authenticated-studio-dependencies-required');
 let generation=0,session=null;
 const valid=t=>typeof t==='string'&&t.trim()===t&&t.length>0;
 const invalidate=()=>{
  generation++;
  session?.app.invalidate();
  session=null;
 };
 async function open(){
  invalidate();
  const current=generation;
  let token;
  try{token=await getAuthToken()}catch{return {ok:false,reason:'authenticated-token-unavailable'}}
  if(current!==generation)return {ok:false,reason:'stale-authentication'};
  if(!valid(token))return {ok:false,reason:'authenticated-token-unavailable'};
  const guardedTransport=async({path,token:presented,body})=>{
   const assertCurrent=()=>{
    if(current!==generation||session?.token!==token||presented!==token)
     throw Error('stale-authenticated-studio-session');
   };
   const checkToken=async()=>{
    assertCurrent();
    let latest;
    try{latest=await getAuthToken()}catch{
     assertCurrent();
     invalidate();throw Error('authenticated-token-unavailable');
    }
    assertCurrent();
    if(!valid(latest)||latest!==token){
     invalidate();throw Error('authenticated-session-rotated');
    }
   };
   await checkToken();
   assertCurrent();
   const result=await transport({path,token,body});
   await checkToken();
   assertCurrent();
   return result;
  };
  const app=createApplicationOwnedStudioServices({
   transport:guardedTransport,getToken:()=>current===generation?token:'',
   selectionVaultId,readLocalBytes,onSelection,onReadOnly,onEditable,onView
  });
  session={token,app};
  return {ok:true,services:app,revision:current};
 }
 const getServices=()=>session?.app||null;
 return Object.freeze({open,getServices,invalidate});
}
