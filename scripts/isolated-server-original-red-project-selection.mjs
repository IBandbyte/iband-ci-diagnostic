// Isolated server-owned alternative to the original frontend's denied local
// active-project mutation. The browser's publication outbox is NEVER a grant.
export function createServerProjectSelectionAuthority({gate,db,client}={}){
 if(!gate?.authenticateOwner||!db||!client)throw Error('server-selection-dependencies-required');
 const states=db.collection('provenance_states'),receipts=db.collection('server_project_selection_receipts');
 async function select({token,projectId,operationId,expectedRevision,nextActiveProjectId}={}){
  const ownerId=gate.authenticateOwner(token);
  if(!ownerId||!projectId||!operationId||!Number.isSafeInteger(expectedRevision)||expectedRevision<0||
     !(nextActiveProjectId===null||(typeof nextActiveProjectId==='string'&&nextActiveProjectId.trim())))return {ok:false,reason:'authentication-or-request-denied'};
  const session=client.startSession();let verdict={ok:false,reason:'authority-unverified'};
  try{
   await session.withTransaction(async()=>{
    const original=await receipts.findOne({projectId,operationId},{session});
    if(original){
     if(original.ownerId===ownerId&&original.expectedRevision===expectedRevision&&
       original.nextActiveProjectId===nextActiveProjectId){
      const current=await states.findOne({projectId,ownerId,revoked:false,ownershipRevision:original.ownershipRevision},{session});
      if(current?.revision>=original.committedRevision&&current.state?.content?.activeProjectId===nextActiveProjectId)
       verdict={ok:true,replayed:true,receipt:{projectId,operationId,committedRevision:original.committedRevision,serverCommitId:original.serverCommitId}};
     }
     return;
    }
    const current=await states.findOne({projectId,ownerId,revision:expectedRevision,revoked:false,activeAdoptionGrant:{$exists:false}},{session});
    if(!current||!Array.isArray(current.state?.durablePublicationOutbox)||!current.state.durablePublicationOutbox.length)return;
    // Must prove publication provenance from the independent server ledger.
    // The shared helper is identical to the source of truth used for writable admission.
    const records=await gate.ledger.find({projectId,ownerId,ownershipRevision:current.ownershipRevision,revision:{$lte:expectedRevision}},{session}).sort({revision:1}).toArray();
    if(records.length!==current.state.durablePublicationOutbox.length)return;
    const {createHash}=await import('node:crypto');
    const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
    if(records.some((r,i)=>digest(r.entry)!==digest(current.state.durablePublicationOutbox[i]))||
       records.at(-1)?.stateDigest!==digest(current.state)||
       records.at(-1)?.fullOutboxDigest!==digest(current.state.durablePublicationOutbox))return;
    // A project selection cannot implicitly create an unowned new project.
    if(nextActiveProjectId!==null&&
       !(current.state.content?.projects||[]).some(p=>p.id===nextActiveProjectId&&p.ownerId===ownerId))return;
    const nextState={...current.state,content:{...current.state.content,activeProjectId:nextActiveProjectId}};
    const changed=await states.updateOne({projectId,ownerId,revision:expectedRevision,revoked:false,ownershipRevision:current.ownershipRevision,activeAdoptionGrant:{$exists:false}},
      {$set:{revision:expectedRevision+1,state:nextState}},{session});
    if(changed.modifiedCount!==1)throw Error('project-selection-cas-conflict');
    const row={projectId,operationId,ownerId,ownershipRevision:current.ownershipRevision,expectedRevision,
      nextActiveProjectId,committedRevision:expectedRevision+1,serverCommitId:'server-selection-'+operationId};
    await receipts.insertOne(row,{session});
    verdict={ok:true,replayed:false,receipt:{projectId,operationId,committedRevision:row.committedRevision,serverCommitId:row.serverCommitId}};
   },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'}});
   return verdict;
  }catch(e){if(e?.code===11000||e?.code===112||e?.hasErrorLabel?.('TransientTransactionError'))return {ok:false,reason:'transaction-conflict'};throw e}
  finally{await session.endSession()}
 }
 async function read({token,projectId}={}){
  const ownerId=gate.authenticateOwner(token);if(!ownerId)return {ok:false};
  const state=await states.findOne({projectId,ownerId,revoked:false});
  return state?{ok:true,projectId,revision:state.revision,activeProjectId:state.state?.content?.activeProjectId}:{ok:false};
 }
 return {select,read,receipts};
}
