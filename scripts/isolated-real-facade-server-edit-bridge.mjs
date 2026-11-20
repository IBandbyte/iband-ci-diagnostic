// Diagnostic-only bridge to the pinned real CreatorMemory facade.
// Server is the ONLY writable authority. Never copy a nonempty publication
// outbox into the local facade or convert an admission into a local witness.
export async function editThroughServerWithRealFacade({
 facade,editor,gate,token,projectId,admissionOperationId,editOperationId,fence,expectedRevision,content
}={}){
 if(!facade||typeof facade.getState!=='function'||typeof facade.continueWithDurableServerAuthority!=='function'||!editor||!gate||!token||!projectId||!admissionOperationId||!editOperationId||!fence)
  return Object.freeze({ok:false,reason:'required-authority-unavailable'});
 if(!editOperationId.startsWith(admissionOperationId+':'))
  return Object.freeze({ok:false,reason:'operation-not-bound-to-admission'});
 const before=JSON.stringify(facade.getState());
 const receipt=await editor.edit({token,projectId,operationId:editOperationId,fence,expectedRevision,content});
 if(JSON.stringify(facade.getState())!==before)
  throw Error('strict-real-facade-mutated-by-server-edit');
 if(!receipt.ok)return Object.freeze({ok:false,reason:'server-edit-denied'});
 // Server receipt is the only write confirmation. The real facade is deliberately
 // NOT rebased, as its process-local publication witness cannot be fabricated.
 const canonical=await gate.states.findOne({projectId,revision:receipt.revision,activeWriterFence:fence,revoked:false});
 if(!canonical)return Object.freeze({ok:false,reason:'canonical-readback-unavailable'});
 return Object.freeze({ok:true,revision:receipt.revision,replay:receipt.replay,restorationMode:'server-authoritative-edit',localStateAdopted:false,localFacadeWritable:false,state:structuredClone(canonical.state)});
}
