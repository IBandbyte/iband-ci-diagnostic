// Diagnostic-only coordinator: real CreatorMemory facade + independently fenced server
// admission. Never promotes a grant into a local publication witness or writable facade.
export async function inspectFencedRealFacade({facade,gate,token,projectId,operationId,fence}={}){
 if(!facade||typeof facade.continueWithDurableServerAuthority!=='function'||!gate||!token||!projectId||!operationId||!fence)
  return Object.freeze({acquired:false,reason:'missing-real-facade-or-authority'});
 const before=JSON.stringify(facade.getState());
 const receipt=await gate.readAdmission({token,projectId,operationId,fence});
 if(!receipt)return Object.freeze({acquired:false,reason:'server-admission-invalid'});
 // No local state mutation is authorized. Only the server's canonical snapshot is
 // exposed to the caller as a read-only result; the strict facade stays fenced.
 if(JSON.stringify(facade.getState())!==before)return Object.freeze({acquired:false,reason:'facade-mutated-during-inspection'});
 return Object.freeze({acquired:true,restorationMode:'server-read-only',localStateAdopted:false,writable:false,revision:receipt.revision,fence:receipt.fence,state:structuredClone(receipt.state)});
}
