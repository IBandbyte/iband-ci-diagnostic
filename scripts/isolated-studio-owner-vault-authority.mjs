// Isolated durable binding authority. Provisioning is a trusted server operation,
// never a public browser request. It binds an already established owned vault.
export function createStudioOwnerVaultAuthority({bindings,authenticateOwner,readSelection}={}){
 if(!bindings||typeof authenticateOwner!=='function'||typeof readSelection!=='function')throw Error('vault-authority-dependencies-required');
 const valid=x=>typeof x==='string'&&x.length>0&&x.trim()===x;
 async function initialize(){
  await bindings.createIndex({ownerId:1},{unique:true});
  await bindings.createIndex({vaultId:1},{unique:true});
 }
 async function provision({token,vaultId}={}){
  const ownerId=await authenticateOwner(token);
  if(!valid(ownerId)||!valid(vaultId))return {ok:false};
  const proof=await readSelection({token,projectId:vaultId});
  if(proof?.ok!==true||proof.projectId!==vaultId)return {ok:false};
  try{await bindings.updateOne({ownerId},{$setOnInsert:{ownerId,vaultId,revoked:false}},{upsert:true});}
  catch(e){if(e?.code!==11000)throw e;}
  const row=await bindings.findOne({ownerId});
  return row?.revoked===false&&row.vaultId===vaultId?{ok:true,vaultId}:{ok:false};
 }
 async function resolve({token}={}){
  const ownerId=await authenticateOwner(token);
  if(!valid(ownerId))return {ok:false};
  const row=await bindings.findOne({ownerId,revoked:false});
  if(!valid(row?.vaultId))return {ok:false};
  const proof=await readSelection({token,projectId:row.vaultId});
  if(proof?.ok!==true||proof.projectId!==row.vaultId)return {ok:false};
  const latest=await bindings.findOne({ownerId,vaultId:row.vaultId,revoked:false});
  return latest?{ok:true,vaultId:row.vaultId}:{ok:false};
 }
 return Object.freeze({initialize,provision,resolve});
}
