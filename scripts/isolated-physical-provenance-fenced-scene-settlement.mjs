// Isolated physical editor for an already admitted, provenance-fenced Film B.
// One transaction owns canonical state, project scene and idempotent receipt.
// This MUST NOT be wired into application main or production databases.
import {createHash,randomUUID} from 'node:crypto';
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export function createPhysicalProvenanceFencedSceneSettlement({client,gate,projects,receipts}={}){
 if(!client||!gate||!projects||!receipts)throw Error('physical-settlement-dependencies-required');
 async function save({token,projectId,operationId,fence,expectedRevision,scene}={}){
  const ownerId=gate.authenticateOwner(token);
  if(!ownerId||!projectId||!operationId?.includes(':')||!fence||
   !Number.isSafeInteger(expectedRevision)||expectedRevision<0||
   typeof scene?.id!=='string'||!scene.id||typeof scene?.text!=='string')return {ok:false};
  const admissionId=operationId.split(':')[0];
  const session=client.startSession();
  let result={ok:false};
  try{
   await session.withTransaction(async()=>{
    const admission=await gate.admissions.findOne({projectId,ownerId,operationId:admissionId,fence,status:'admitted'},{session});
    if(!admission)return;
    const canonical=await gate.states.findOne({projectId,ownerId,ownershipRevision:admission.ownershipRevision,
      activeAdoptionGrant:admission.grantId,activeWriterFence:fence,revoked:false},{session});
    if(!canonical)return;
    const prior=await receipts.findOne({projectId,operationId},{session});
    const project=await projects.findOne({_id:projectId,ownerId},{session});
    if(!project||canonical.revision!==project.revision||
       digest(canonical.state?.content?.scenes)!==digest(project.state?.scenes))return;
    if(prior){
     if(prior.ownerId===ownerId&&prior.fence===fence&&prior.expectedRevision===expectedRevision&&
       prior.revision===expectedRevision+1&&digest(prior.scene)===digest(scene)&&
       canonical.revision>=prior.revision&&
       canonical.state.content.scenes.some(s=>s.id===scene.id&&s.text===scene.text))
       result={ok:true,replay:true,projectId,operationId,committedRevision:prior.revision,serverCommitId:prior.commitId};
     return;
    }
    if(canonical.revision!==expectedRevision||!Array.isArray(project.state?.scenes)||
      project.state.scenes.some(s=>s.id===scene.id))return;
    const nextScenes=[...project.state.scenes,scene];
    const entry={id:randomUUID(),status:'pending',committedStateVersion:canonical.state.durablePublicationOutbox.length+1,snapshotDigest:digest({content:{scenes:nextScenes},revision:expectedRevision+1})};
    const outbox=[...canonical.state.durablePublicationOutbox,entry];
    const nextState={...canonical.state,content:{...canonical.state.content,scenes:nextScenes},durablePublicationOutbox:outbox};
    const projectUpdate=await projects.updateOne({_id:projectId,ownerId,revision:expectedRevision},
      {$set:{revision:expectedRevision+1,state:{scenes:nextScenes}}},{session});
    if(projectUpdate.matchedCount!==1)throw Error('project-revision-race');
    const canonicalUpdate=await gate.states.updateOne({_id:canonical._id,revision:expectedRevision,
      activeWriterFence:fence,revoked:false},{$set:{revision:expectedRevision+1,state:nextState}},{session});
    if(canonicalUpdate.matchedCount!==1)throw Error('canonical-revision-race');
    await gate.ledger.insertOne({projectId,operationId,ownerId,ownershipRevision:canonical.ownershipRevision,revision:expectedRevision+1,entry,fullOutboxDigest:digest(outbox),stateDigest:digest(nextState)},{session});
    const commitId=digest({projectId,operationId,ownerId,fence,revision:expectedRevision+1,scene});
    await receipts.insertOne({projectId,operationId,ownerId,fence,admissionId,expectedRevision,
      revision:expectedRevision+1,scene,commitId,state:{scenes:nextScenes}},{session});
    result={ok:true,replay:false,projectId,operationId,committedRevision:expectedRevision+1,serverCommitId:commitId};
   },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'}});
  }catch(e){if(!e?.hasErrorLabel?.('TransientTransactionError')&&e?.code!==112&&e?.code!==11000)throw e}
  finally{await session.endSession()}
  return result;
 }
 async function readCommitted({token,projectId,operationId}={}){
  const ownerId=gate.authenticateOwner(token);if(!ownerId)return null;
  const prior=await receipts.findOne({projectId,operationId,ownerId});
  if(!prior)return null;
  const admission=await gate.admissions.findOne({projectId,ownerId,operationId:prior.admissionId,fence:prior.fence,status:'admitted'});
  if(!admission)return null;
  const canonical=await gate.states.findOne({projectId,ownerId,ownershipRevision:admission.ownershipRevision,revoked:false,
    activeAdoptionGrant:admission.grantId,activeWriterFence:prior.fence});
  const project=await projects.findOne({_id:projectId,ownerId});
  if(!canonical||!project||canonical.revision!==project.revision||
    digest(canonical.state?.content?.scenes)!==digest(project.state?.scenes)||
    canonical.revision<prior.revision||
    !project.state.scenes.some(s=>s.id===prior.scene.id&&s.text===prior.scene.text))return null;
  return {ok:true,projectId,operationId,revision:prior.revision,serverCommitId:prior.commitId,state:{scenes:structuredClone(project.state.scenes)}};
 }
 return Object.freeze({save,readCommitted});
}
