// Isolated Mongo positive editor; never wired to application or browser local storage.
import {createHash} from 'node:crypto';
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export function createServerOwnedEditor({gate,db,client}){
 const edits=db.collection('server_fenced_creator_edits');
 async function edit({token,projectId,operationId,fence,expectedRevision,content}){
  if(typeof content!=='string'||content.length>10000||!operationId||!Number.isSafeInteger(expectedRevision))return {ok:false};
  const admission=await gate.readAdmission({token,projectId,operationId:operationId.split(':')[0],fence});
  if(!admission)return {ok:false};
  const session=client.startSession();let result={ok:false};
  try{
   await session.withTransaction(async()=>{
    const prior=await edits.findOne({projectId,operationId},{session});
    if(prior){
     if(prior.fence===fence&&prior.expectedRevision===expectedRevision&&prior.contentDigest===digest(content)&&prior.admissionOperationId===operationId.split(':')[0])result={ok:true,replay:true,revision:prior.revision};
     return;
    }
    const state=await gate.states.findOne({projectId,revision:expectedRevision,activeWriterFence:fence,activeAdoptionGrant:{$exists:true},revoked:false},{session});
    if(!state||state.ownerId!== (await gate.admissions.findOne({projectId,operationId:operationId.split(':')[0],fence,status:'admitted'},{session}))?.ownerId)return;
    const last=await edits.find({projectId,fence},{session}).sort({revision:-1}).limit(1).next();
    if(last){
     if(last.revision!==expectedRevision||last.stateDigest!==digest(state.state))return;
    }else if(admission.revision!==expectedRevision||digest(state.state)!==digest(admission.state))return;
    const next={...state.state,content};
    const updated=await gate.states.updateOne({_id:state._id,revision:expectedRevision,activeWriterFence:fence,revoked:false},{$set:{revision:expectedRevision+1,state:next}},{session});
    if(updated.matchedCount!==1)throw Error('concurrent-editor-conflict');
    await edits.insertOne({projectId,operationId,admissionOperationId:operationId.split(':')[0],fence,ownerId:state.ownerId,ownershipRevision:state.ownershipRevision,expectedRevision,revision:expectedRevision+1,contentDigest:digest(content),stateDigest:digest(next),outboxDigest:digest(next.durablePublicationOutbox)},{session});
    result={ok:true,replay:false,revision:expectedRevision+1};
   },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'}});
  }catch(e){if(!e?.hasErrorLabel?.('TransientTransactionError')&&e?.code!==112&&e?.code!==11000)throw e}
  finally{await session.endSession()}
  return result;
 }
 return {edits,edit};
}
