// Isolated Mongo positive editor; never wired to application or browser local storage.
import {createHash,verify} from 'node:crypto';
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function authenticatedOwner(token,key){try{const parts=token.split('.');if(parts.length!==3)return null;const h=JSON.parse(Buffer.from(parts[0],'base64url')),p=JSON.parse(Buffer.from(parts[1],'base64url')),now=Math.floor(Date.now()/1000);return h.alg==='RS256'&&h.typ==='JWT'&&p.iss==='https://isolated-auth.test'&&p.aud==='movie-mentor-creator-write'&&typeof p.sub==='string'&&p.sub&&Number.isInteger(p.iat)&&p.iat<=now&&Number.isInteger(p.nbf)&&p.nbf<=now&&Number.isInteger(p.exp)&&p.exp>now&&verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),key,Buffer.from(parts[2],'base64url'))?p.sub:null}catch{return null}}
export function createServerOwnedEditor({gate,db,client,publicKey}){
 const edits=db.collection('server_fenced_creator_edits');
 async function edit({token,projectId,operationId,fence,expectedRevision,content}){
  if(typeof content!=='string'||content.length>10000||!operationId||!Number.isSafeInteger(expectedRevision))return {ok:false};
  const admissionOperationId=operationId.split(':')[0];
  const ownerId=authenticatedOwner(token,publicKey);
  if(!ownerId||!admissionOperationId||admissionOperationId===operationId)return {ok:false};
  const session=client.startSession();let result={ok:false};
  try{
   await session.withTransaction(async()=>{
    const prior=await edits.findOne({projectId,operationId},{session});
    if(prior){
     const canonical=await gate.states.findOne({projectId,ownerId,revoked:false,activeWriterFence:fence,activeAdoptionGrant:{$exists:true}},{session});
     const admission=await gate.admissions.findOne({projectId,ownerId,operationId:admissionOperationId,fence,status:'admitted'},{session});
     if(canonical&&admission&&prior.ownerId===ownerId&&prior.ownershipRevision===canonical.ownershipRevision&&admission.ownershipRevision===canonical.ownershipRevision&&canonical.activeAdoptionGrant===admission.grantId&&prior.fence===fence&&prior.expectedRevision===expectedRevision&&prior.revision===expectedRevision+1&&prior.contentDigest===digest(content)&&prior.admissionOperationId===admissionOperationId&&canonical.revision>=prior.revision){
      // A historical receipt is idempotent acknowledgement, NOT authority to
      // rewrite the current state. Verify an unbroken receipt chain from the
      // requested operation through the current canonical revision.
      const chain=await edits.find({projectId,fence,ownerId,ownershipRevision:canonical.ownershipRevision,revision:{$gte:prior.revision,$lte:canonical.revision}},{session}).sort({revision:1}).toArray();
      const contiguous=chain.length===canonical.revision-prior.revision+1&&chain.every((entry,index)=>entry.revision===prior.revision+index&&entry.expectedRevision===entry.revision-1&&entry.admissionOperationId===admissionOperationId);
      const latest=chain.at(-1);
      if(contiguous&&chain[0].operationId===operationId&&latest.stateDigest===digest(canonical.state)&&latest.outboxDigest===digest(canonical.state.durablePublicationOutbox))
       result={ok:true,replay:true,revision:prior.revision};
     }
     return;
    }
    const admission=await gate.admissions.findOne({projectId,ownerId,operationId:admissionOperationId,fence,status:'admitted'},{session});
    if(!admission)return;
    const state=await gate.states.findOne({projectId,revision:expectedRevision,activeWriterFence:fence,activeAdoptionGrant:{$exists:true},revoked:false},{session});
    if(!state||state.ownerId!==ownerId||state.ownershipRevision!==admission.ownershipRevision||state.activeAdoptionGrant!==admission.grantId)return;
    const last=await edits.find({projectId,fence},{session}).sort({revision:-1}).limit(1).next();
    if(last){
     if(last.revision!==expectedRevision||last.stateDigest!==digest(state.state)||last.ownershipRevision!==state.ownershipRevision||last.outboxDigest!==digest(state.state.durablePublicationOutbox))return;
    }else if(admission.revision!==expectedRevision||digest(state.state)!==admission.stateDigest)return;
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
