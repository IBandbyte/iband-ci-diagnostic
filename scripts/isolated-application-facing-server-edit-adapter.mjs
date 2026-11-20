// Diagnostic-only application-facing contract. NOT wired to application main.
// The server is the only source of editing authority and canonical film state.
// This adapter never imports a local storage writer or promotes publication history.
import {editThroughServerWithRealFacade} from './isolated-real-facade-server-edit-bridge.mjs';

export function createServerOwnedCreatorEditingAdapter({facade,gate,editor,token,projectId,admissionOperationId,fence}={}){
 const required=Boolean(facade&&gate&&editor&&token&&projectId&&admissionOperationId&&fence);
 const reject=reason=>Object.freeze({ok:false,reason,localFacadeWritable:false,localStateAdopted:false});
 const snapshot=()=>JSON.stringify(facade.getState());
 async function read(){
  if(!required)return reject('required-authority-unavailable');
  const before=snapshot();
  // Readback is NOT an authority grant: never infer ownership from this data.
  const canonical=await gate.states.findOne({projectId,activeWriterFence:fence,revoked:false});
  if(snapshot()!==before)throw Error('strict-facade-mutated-by-canonical-read');
  if(!canonical)return reject('canonical-readback-unavailable');
  return Object.freeze({ok:true,canonicalRevision:canonical.revision,state:structuredClone(canonical.state),restorationMode:'server-read-only',localFacadeWritable:false,localStateAdopted:false});
 }
 async function edit({operationId,expectedRevision,content}={}){
  if(!required)return reject('required-authority-unavailable');
  if(typeof operationId!=='string'||!operationId.startsWith(admissionOperationId+':')||!Number.isSafeInteger(expectedRevision))
   return reject('invalid-edit-request');
  const result=await editThroughServerWithRealFacade({facade,gate,editor,token,projectId,admissionOperationId,editOperationId:operationId,fence,expectedRevision,content});
  if(!result.ok)return reject(result.reason||'server-edit-denied');
  return Object.freeze({...result,restorationMode:'server-authoritative-edit',localFacadeWritable:false,localStateAdopted:false});
 }
 return Object.freeze({read,edit});
}
