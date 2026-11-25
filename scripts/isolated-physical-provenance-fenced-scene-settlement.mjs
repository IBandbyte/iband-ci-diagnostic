// Isolated physical editor for an already admitted, provenance-fenced Film B.
// One transaction owns canonical state, project scene and idempotent receipt.
// This MUST NOT be wired into application main or production databases.
import {createHash,randomUUID} from 'node:crypto';
import {validateConversationSettlement} from './isolated-conversation-settlement-contract.mjs';
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
 async function settleConversation({token,selectionVaultId,fence,...input}={}){
  const ownerId=gate.authenticateOwner(token);
  let valid;try{valid=validateConversationSettlement(input)}catch{return {ok:false}}
  if(!ownerId||typeof selectionVaultId!=='string'||!fence||!valid.operationId.includes(':'))return {ok:false};
  const {projectId,operationId,creatorTurnId,expectedRevision,creatorMessage,mentorMessage}=valid;
  const admissionId=operationId.split(':')[0],session=client.startSession();
  try{return await session.withTransaction(async()=>{
   const vault=await gate.states.findOne({projectId:selectionVaultId,ownerId,revoked:false,'state.content.activeProjectId':projectId},{session});
   if(!vault)return {ok:false};
   const admission=await gate.admissions.findOne({projectId,ownerId,operationId:admissionId,fence,status:'admitted'},{session});
   if(!admission)return {ok:false};
   const canonical=await gate.states.findOne({projectId,ownerId,ownershipRevision:admission.ownershipRevision,activeAdoptionGrant:admission.grantId,activeWriterFence:fence,revoked:false},{session});
   const project=await projects.findOne({_id:projectId,ownerId},{session});
   if(!canonical||!project||canonical.revision!==project.revision||digest(canonical.state.content)!==digest(project.state)||!Array.isArray(project.state.conversationMessages))return {ok:false};
   const records=await gate.ledger.find({projectId,ownerId,ownershipRevision:canonical.ownershipRevision},{session}).sort({revision:1}).toArray();
   const outbox=canonical.state.durablePublicationOutbox;
   if(!Array.isArray(outbox)||!records.length||records.length!==outbox.length||records.some((r,i)=>digest(r.entry)!==digest(outbox[i]))||records.at(-1).stateDigest!==digest(canonical.state)||records.at(-1).fullOutboxDigest!==digest(outbox))return {ok:false};
   const prior=await receipts.findOne({projectId,operationId},{session}),fingerprint=digest(valid);
   if(prior){
    if(prior.ownerId!==ownerId||prior.fence!==fence||prior.fingerprint!==fingerprint||prior.creatorTurnId!==creatorTurnId||canonical.revision<prior.revision)return {ok:false};
   }else if(canonical.revision!==expectedRevision||await receipts.findOne({projectId,creatorTurnId},{session})||project.state.conversationMessages.some(m=>m.id===creatorMessage.id||m.id===mentorMessage.id)||creatorMessage.id===mentorMessage.id)return {ok:false};
   const locked=await gate.states.updateOne({_id:vault._id,revision:vault.revision,revoked:false,'state.content.activeProjectId':projectId},{$inc:{conversationSelectionFence:1}},{session});
   if(locked.modifiedCount!==1)throw Error('conversation-selection-race');
   if(prior)return {ok:true,replay:true,projectId,operationId,creatorTurnId,committedRevision:prior.revision,serverCommitId:prior.commitId};
   const content={...project.state,conversationMessages:[...project.state.conversationMessages,creatorMessage,mentorMessage]},revision=expectedRevision+1;
   const entry={id:randomUUID(),status:'pending',committedStateVersion:outbox.length+1,snapshotDigest:digest({content,revision})};
   const next={...canonical.state,content,durablePublicationOutbox:[...outbox,entry]};
   const p=await projects.updateOne({_id:projectId,ownerId,revision:expectedRevision},{$set:{revision,state:content}},{session});
   const c=await gate.states.updateOne({_id:canonical._id,revision:expectedRevision,activeWriterFence:fence,revoked:false},{$set:{revision,state:next}},{session});
   if(p.modifiedCount!==1||c.modifiedCount!==1)throw Error('conversation-revision-race');
   await gate.ledger.insertOne({projectId,operationId,ownerId,ownershipRevision:canonical.ownershipRevision,revision,entry,fullOutboxDigest:digest(next.durablePublicationOutbox),stateDigest:digest(next)},{session});
   const commitId=digest({projectId,operationId,ownerId,fence,fingerprint,revision});
   await receipts.insertOne({projectId,operationId,creatorTurnId,ownerId,fence,admissionId,expectedRevision,revision,fingerprint,commitId},{session});
   return {ok:true,replay:false,projectId,operationId,creatorTurnId,committedRevision:revision,serverCommitId:commitId};
  },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'}})}
  catch(e){if(e?.code===11000||e?.code===112||e?.hasErrorLabel?.('TransientTransactionError'))return {ok:false};throw e}
  finally{await session.endSession()}
 }
 async function readConversationReceipt({token,projectId,operationId}={}){
  const ownerId=gate.authenticateOwner(token);if(!ownerId)return {ok:false};
  const prior=await receipts.findOne({projectId,operationId,ownerId});
  if(!prior?.creatorTurnId)return {ok:false};
  const canonical=await gate.states.findOne({projectId,ownerId,revoked:false});
  const project=await projects.findOne({_id:projectId,ownerId});
  if(!canonical||!project||canonical.revision!==project.revision||canonical.revision<prior.revision||digest(canonical.state.content)!==digest(project.state))return {ok:false};
  const records=await gate.ledger.find({projectId,ownerId,ownershipRevision:canonical.ownershipRevision}).sort({revision:1}).toArray();
  const outbox=canonical.state.durablePublicationOutbox;
  if(!Array.isArray(outbox)||!records.length||records.length!==outbox.length||records.some((r,i)=>digest(r.entry)!==digest(outbox[i]))||records.at(-1).stateDigest!==digest(canonical.state)||records.at(-1).fullOutboxDigest!==digest(outbox))return {ok:false};
  if(!records.some(r=>r.operationId===operationId&&r.revision===prior.revision))return {ok:false};
  return {ok:true,projectId,operationId,creatorTurnId:prior.creatorTurnId,committedRevision:prior.revision,serverCommitId:prior.commitId};
 }
 async function retireConversationWriter({token,selectionVaultId,projectId,operationId,fence,serverCommitId}={}){
  const ownerId=gate.authenticateOwner(token);if(!ownerId||!selectionVaultId||!fence||!serverCommitId)return {ok:false};
  const session=client.startSession();
  try{return await session.withTransaction(async()=>{
   const vault=await gate.states.findOne({projectId:selectionVaultId,ownerId,revoked:false,'state.content.activeProjectId':projectId},{session});
   if(!vault)return {ok:false};
   const prior=await receipts.findOne({projectId,ownerId,operationId,fence,commitId:serverCommitId},{session});
   if(!prior?.creatorTurnId)return {ok:false};
   const admission=await gate.admissions.findOne({projectId,ownerId,operationId:prior.admissionId,fence},{session});
   const canonical=await gate.states.findOne({projectId,ownerId,revoked:false,ownershipRevision:admission?.ownershipRevision},{session});
   if(!admission||!canonical||canonical.revision<prior.revision)return {ok:false};
   if(admission.status==='retired')return {ok:true,projectId,operationId,serverCommitId,retired:true};
   if(admission.status!=='admitted'||canonical.activeWriterFence!==fence||canonical.activeAdoptionGrant!==admission.grantId||canonical.revision!==prior.revision)return {ok:false};
   const locked=await gate.states.updateOne({_id:vault._id,revision:vault.revision,revoked:false,'state.content.activeProjectId':projectId},{$inc:{conversationSelectionFence:1}},{session});
   if(locked.modifiedCount!==1)throw Error('conversation-retirement-selection-race');
   const changed=await gate.states.updateOne({_id:canonical._id,revision:prior.revision,activeWriterFence:fence,revoked:false},{$unset:{activeWriterFence:'',activeAdoptionGrant:''}},{session});
   const retired=await gate.admissions.updateOne({_id:admission._id,status:'admitted'},{$set:{status:'retired'}},{session});
   if(changed.modifiedCount!==1||retired.modifiedCount!==1)throw Error('conversation-retirement-race');
   return {ok:true,projectId,operationId,serverCommitId,retired:true};
  },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'}})}
  catch(e){if(e?.code===112||e?.code===11000||e?.hasErrorLabel?.('TransientTransactionError'))return {ok:false};throw e}
  finally{await session.endSession()}
 }
 return Object.freeze({save,readCommitted,settleConversation,readConversationReceipt,retireConversationWriter});
}
