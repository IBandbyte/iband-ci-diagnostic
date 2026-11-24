// Isolated durable binding authority. Provisioning is a trusted server operation,
// never a public browser request. It binds an already established owned vault.
import {createHash,randomUUID} from 'node:crypto';
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export function createStudioOwnerVaultAuthority({bindings,states,ledger,client,authenticateOwner,readSelection}={}){
 if(!bindings||!states||!ledger||!client||typeof authenticateOwner!=='function'||typeof readSelection!=='function')throw Error('vault-authority-dependencies-required');
 const valid=x=>typeof x==='string'&&x.length>0&&x.trim()===x;
 async function initialize(){
  await bindings.createIndex({ownerId:1},{unique:true});
  await bindings.createIndex({vaultId:1},{unique:true});
  await states.createIndex({projectId:1},{unique:true});
  await ledger.createIndex({projectId:1,operationId:1},{unique:true});
 }
 // Create only the server-generated empty vault. No caller content or identity.
 async function create({token}={}){
  const ownerId=await authenticateOwner(token);
  if(!valid(ownerId))return {ok:false};
  const vaultId='studio-vault-'+randomUUID();
  const content={activeProjectId:null,projects:[]};
  const entry={id:randomUUID(),status:'pending',committedStateVersion:1,snapshotDigest:digest({content,revision:1})};
  const state={content,durablePublicationOutbox:[entry]};
  const session=client.startSession();
  try{
   return await session.withTransaction(async()=>{
    const existing=await bindings.findOne({ownerId},{session});
    if(existing){
     const owned=await states.findOne({projectId:existing.vaultId,ownerId,revoked:false},{session});
     return existing.revoked===false&&owned?{ok:true,vaultId:existing.vaultId,replayed:true}:{ok:false};
    }
    await states.insertOne({projectId:vaultId,ownerId,revision:1,ownershipRevision:1,revoked:false,state},{session});
    await ledger.insertOne({projectId:vaultId,operationId:'vault-genesis',ownerId,ownershipRevision:1,revision:1,entry,fullOutboxDigest:digest(state.durablePublicationOutbox),stateDigest:digest(state)},{session});
    await bindings.insertOne({ownerId,vaultId,revoked:false},{session});
    return {ok:true,vaultId,replayed:false};
   },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'}});
  }catch(e){
   if(e?.code!==11000)throw e;
   const found=await resolve({token});
   return found.ok?{...found,replayed:true}:{ok:false};
  }finally{await session.endSession()}
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
 // Trusted server lifecycle operation. Both documents are fenced together.
 async function revoke({token}={}){
  const ownerId=await authenticateOwner(token);
  if(!valid(ownerId))return {ok:false};
  const session=client.startSession();
  try{
   return await session.withTransaction(async()=>{
    const row=await bindings.findOne({ownerId},{session});
    if(!row||!valid(row.vaultId))return {ok:false};
    const state=await states.findOne({projectId:row.vaultId,ownerId},{session});
    if(!state)return {ok:false};
    if(row.revoked===true)return state.revoked===true?{ok:true,replayed:true}:{ok:false};
    if(row.revoked!==false||state.revoked!==false||!Number.isSafeInteger(state.ownershipRevision))return {ok:false};
    const fence=await states.updateOne({projectId:row.vaultId,ownerId,revoked:false,ownershipRevision:state.ownershipRevision},{$set:{revoked:true},$inc:{ownershipRevision:1}},{session});
    if(fence.modifiedCount!==1)throw Error('vault-revocation-state-conflict');
    const changed=await bindings.updateOne({ownerId,vaultId:row.vaultId,revoked:false},{$set:{revoked:true}},{session});
    if(changed.modifiedCount!==1)throw Error('vault-revocation-binding-conflict');
    return {ok:true,replayed:false};
   },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'}});
  }finally{await session.endSession()}
 }
 return Object.freeze({initialize,create,provision,resolve,revoke});
}
