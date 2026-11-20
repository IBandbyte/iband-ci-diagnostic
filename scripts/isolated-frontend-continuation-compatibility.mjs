// Isolated trusted-server compatibility for the pinned real frontend boundary.
// Never ship to the browser or expose a raw Mongo object as client authority.
import {createHash} from 'node:crypto';
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const commitId=({projectId,operationId,ownerId,revision})=>digest({projectId,operationId,ownerId,revision});
export function createFrontendContinuationCompatibility({gate,editor,token,projectId,admissionOperationId,fence}={}){
 const owner=()=>gate?.authenticateOwner?.(token)||null;
 async function authorized(){
  const ownerId=owner();if(!ownerId)return null;
  const admission=await gate.admissions.findOne({projectId,operationId:admissionOperationId,ownerId,fence,status:'admitted'});
  if(!admission)return null;
  const canonical=await gate.states.findOne({projectId,ownerId,ownershipRevision:admission.ownershipRevision,activeWriterFence:fence,activeAdoptionGrant:admission.grantId,revoked:false});
  return canonical?{ownerId,admission,canonical}:null;
 }
 async function commit({authenticatedSession,projectId:requestedProject,operationId,expectedRevision,proposedState}={}){
  if(!authenticatedSession||requestedProject!==projectId||!operationId?.startsWith(admissionOperationId+':')||!Number.isSafeInteger(expectedRevision)||!proposedState||typeof proposedState.content!=='string')return null;
  const auth=await authorized();if(!auth)return null;
  // A whole-state proposal is never an authority: permit only a content change.
  const prior=await editor.edits.findOne({projectId,operationId});
  const baseline=prior?.committedState
   ? {...prior.committedState,content:undefined}
   : {...auth.canonical.state,content:undefined};
  if(digest({...proposedState,content:undefined})!==digest(baseline))return null;
  const result=await editor.edit({token,projectId,operationId,fence,expectedRevision,content:proposedState.content});
  if(!result.ok)return null;
  const receipt=await editor.edits.findOne({projectId,operationId,ownerId:auth.ownerId,fence,revision:result.revision});
  if(!receipt?.committedState||digest(receipt.committedState)!==receipt.stateDigest||digest(receipt.committedState)!==digest(proposedState))return null;
  return {status:'committed',projectId,operationId,committedRevision:receipt.revision,serverCommitId:commitId({projectId,operationId,ownerId:auth.ownerId,revision:receipt.revision})};
 }
 async function readCommitted({authenticatedSession,projectId:requestedProject,operationId}={}){
  if(!authenticatedSession||requestedProject!==projectId)return null;
  const auth=await authorized();if(!auth)return null;
  const receipt=await editor.edits.findOne({projectId,operationId,ownerId:auth.ownerId,fence,ownershipRevision:auth.canonical.ownershipRevision});
  if(!receipt?.committedState||digest(receipt.committedState)!==receipt.stateDigest)return null;
  return {projectId,operationId,committedRevision:receipt.revision,serverCommitId:commitId({projectId,operationId,ownerId:auth.ownerId,revision:receipt.revision}),state:structuredClone(receipt.committedState)};
 }
 return Object.freeze({commit,readCommitted});
}
