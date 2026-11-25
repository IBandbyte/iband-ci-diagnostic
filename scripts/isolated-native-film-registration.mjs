// Diagnostic composition: native registry is the only ownership mint.
import {createHash,randomUUID} from 'node:crypto';
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export function createNativeFilmRegistration({client,states,ledger,bindings,projects,ownershipAuthority,authenticateOwner}){
 async function register({token,projectId}){
  const ownerId=await authenticateOwner(token);
  if(!ownerId||typeof projectId!=='string'||!projectId.startsWith('movie-project-'))return {ok:false};
  const proof=await ownershipAuthority.authorizeProject({principal:{authenticated:true,principalId:ownerId},projectId});
  if(proof?.authorized!==true||proof.projectId!==projectId||!Number.isSafeInteger(proof.ownershipRevision))return {ok:false};
  const session=client.startSession();
  try{return await session.withTransaction(async()=>{
   const binding=await bindings.findOne({ownerId,revoked:false},{session});
   if(!binding||binding.vaultId===projectId)return {ok:false};
   const vault=await states.findOne({projectId:binding.vaultId,ownerId,revoked:false,activeAdoptionGrant:{$exists:false}},{session});
   if(!vault||!Array.isArray(vault.state?.content?.projects)||!Array.isArray(vault.state?.durablePublicationOutbox))return {ok:false};
   const records=await ledger.find({projectId:vault.projectId,ownerId,ownershipRevision:vault.ownershipRevision},{session}).sort({revision:1}).toArray();
   if(records.length!==vault.state.durablePublicationOutbox.length||!records.length||records.some((r,i)=>digest(r.entry)!==digest(vault.state.durablePublicationOutbox[i]))||records.at(-1).stateDigest!==digest(vault.state)||records.at(-1).fullOutboxDigest!==digest(vault.state.durablePublicationOutbox))return {ok:false};
   const existing=await states.findOne({projectId},{session});
   if(existing){
    const p=await projects.findOne({_id:projectId,ownerId},{session});
    return existing.ownerId===ownerId&&existing.revoked===false&&existing.ownershipRevision===proof.ownershipRevision&&p&&vault.state.content.projects.some(x=>x.id===projectId&&x.ownerId===ownerId)?{ok:true,projectId,replayed:true}:{ok:false};
   }
   if(vault.state.content.projects.some(x=>x.id===projectId))return {ok:false};
   const content={scenes:[],conversationMessages:[]};
   const entry={id:randomUUID(),status:'pending',committedStateVersion:1,snapshotDigest:digest({content,revision:1})};
   const state={content,durablePublicationOutbox:[entry]};
   await states.insertOne({projectId,ownerId,revision:1,ownershipRevision:proof.ownershipRevision,revoked:false,state},{session});
   await projects.insertOne({_id:projectId,ownerId,revision:1,state:content},{session});
   await ledger.insertOne({projectId,ownerId,ownershipRevision:proof.ownershipRevision,revision:1,operationId:'native-genesis',entry,stateDigest:digest(state),fullOutboxDigest:digest(state.durablePublicationOutbox)},{session});
   const nextContent={...vault.state.content,projects:[...vault.state.content.projects,{id:projectId,ownerId}]};
   const revision=vault.revision+1;
   const nextEntry={id:randomUUID(),status:'pending',committedStateVersion:records.length+1,snapshotDigest:digest({content:nextContent,revision})};
   const next={content:nextContent,durablePublicationOutbox:[...vault.state.durablePublicationOutbox,nextEntry]};
   const changed=await states.updateOne({projectId:vault.projectId,ownerId,revision:vault.revision,ownershipRevision:vault.ownershipRevision,revoked:false},{$set:{revision,state:next}},{session});
   if(changed.modifiedCount!==1)throw Error('vault-registration-conflict');
   await ledger.insertOne({projectId:vault.projectId,ownerId,ownershipRevision:vault.ownershipRevision,revision,operationId:'register:'+projectId,entry:nextEntry,stateDigest:digest(next),fullOutboxDigest:digest(next.durablePublicationOutbox)},{session});
   return {ok:true,projectId,replayed:false};
  },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'}})}finally{await session.endSession()}
 }
 return {register};
}
