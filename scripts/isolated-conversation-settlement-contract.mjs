// Isolated server-owned conversation settlement input contract.
// This module validates untrusted browser input; it does not itself authorize writes.
const clean=x=>typeof x==='string'?x.trim():'';
export function validateConversationSettlement(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('invalid-settlement-input');
 const {projectId,operationId,creatorTurnId,expectedRevision,creatorMessage,mentorMessage}=input;
 if(!clean(projectId)||!clean(operationId)||!clean(creatorTurnId))throw Error('missing-settlement-identity');
 if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw Error('invalid-expected-revision');
 if(!creatorMessage||creatorMessage.role!=='creator'||!clean(creatorMessage.text)||!clean(creatorMessage.id))throw Error('invalid-creator-message');
 if(!mentorMessage||mentorMessage.role!=='mentor'||!clean(mentorMessage.text)||!clean(mentorMessage.id))throw Error('invalid-mentor-message');
 if(clean(mentorMessage.metadata?.backendMetadata?.creatorTurnId)!==creatorTurnId)throw Error('mentor-turn-identity-mismatch');
 if(clean(creatorMessage.id)!==creatorTurnId)throw Error('creator-turn-identity-mismatch');
 return Object.freeze({projectId,operationId,creatorTurnId,expectedRevision,creatorMessage:structuredClone(creatorMessage),mentorMessage:structuredClone(mentorMessage)});
}
export function classifySettlementOutcome({receipt,operationId,creatorTurnId}){
 if(!receipt)return Object.freeze({status:'unknown',retirePending:false});
 if(receipt.operationId!==operationId||receipt.creatorTurnId!==creatorTurnId||!clean(receipt.serverCommitId)||!Number.isSafeInteger(receipt.committedRevision))throw Error('invalid-settlement-receipt');
 return Object.freeze({status:'confirmed',retirePending:true,serverCommitId:receipt.serverCommitId,committedRevision:receipt.committedRevision});
}
