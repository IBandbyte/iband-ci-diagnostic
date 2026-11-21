// Isolated candidate for wiring server authority into Studio; not production UI code.
import {createStudioConversationAuthority} from './isolated-studio-conversation-authority.mjs';
export function createStudioServerAuthorityAdapter({settle,readConfirmed,publishConfirmed}={}){
 if(typeof publishConfirmed!=='function')throw Error('confirmed-publication-required');
 const gate=createStudioConversationAuthority({settle,readConfirmed});
 const epochs=new Map(),pendingByProject=new Map();
 const bump=id=>{const n=(epochs.get(id)||0)+1;epochs.set(id,n);return n};
 const pending=id=>pendingByProject.get(id)||new Set();
 return Object.freeze({
  stage(input){
   const result=gate.stage(input);const id=input.projectId;
   const turns=new Set(pending(id));turns.add(input.creatorTurnId);pendingByProject.set(id,turns);bump(id);
   return result;
  },
  async confirm(projectId,creatorTurnId){
   const result=await gate.confirm(projectId,creatorTurnId);
   if(result.durable===true){
    const turns=new Set(pending(projectId));turns.delete(creatorTurnId);pendingByProject.set(projectId,turns);bump(projectId);
   }
   return result;
  },
  async restore(projectId){
   if(pending(projectId).size) return {status:'blocked-pending',published:false};
   const epoch=epochs.get(projectId)||0;
   const recovered=await gate.restore(projectId);
   if((epochs.get(projectId)||0)!==epoch||pending(projectId).size) return {status:'stale-local-change',published:false};
   await publishConfirmed(structuredClone(recovered));
   return {status:'confirmed',published:true,revision:recovered.revision};
  },
  hasPending:(projectId,creatorTurnId)=>gate.hasPending(projectId,creatorTurnId)
 });
}
