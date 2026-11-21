// Isolated browser-side conversation authority gate; never treats optimistic UI as durable.
// This is a proposed integration seam, not a modification of the pinned studio.
import {validateConversationSettlement,classifySettlementOutcome} from './isolated-conversation-settlement-contract.mjs';
export function createStudioConversationAuthority({settle,readConfirmed}={}){
 if(typeof settle!=='function'||typeof readConfirmed!=='function')throw Error('server-authority-required');
 const pending=new Map();
 const key=(projectId,creatorTurnId)=>projectId+'\\0'+creatorTurnId;
 return Object.freeze({
  stage(input){const valid=validateConversationSettlement(input);const id=key(valid.projectId,valid.creatorTurnId);const previous=pending.get(id);if(previous&&JSON.stringify(previous)!==JSON.stringify(valid))throw Error('pending-turn-conflict');pending.set(id,valid);return {status:'pending',durable:false};},
  async confirm(projectId,creatorTurnId){const id=key(projectId,creatorTurnId),input=pending.get(id);if(!input)throw Error('pending-turn-required');
   let receipt;try{receipt=await settle(input)}catch{return {status:'unknown',durable:false}};
   const outcome=classifySettlementOutcome({receipt,operationId:input.operationId,creatorTurnId});
   if(outcome.retirePending)pending.delete(id);
   return {...outcome,durable:outcome.retirePending};
  },
  async restore(projectId){const result=await readConfirmed(projectId);if(!result||result.projectId!==projectId||!Number.isSafeInteger(result.revision)||!Array.isArray(result.conversation))throw Error('unverified-server-recovery');return structuredClone(result)},
  hasPending(projectId,creatorTurnId){return pending.has(key(projectId,creatorTurnId))}
 });
}
