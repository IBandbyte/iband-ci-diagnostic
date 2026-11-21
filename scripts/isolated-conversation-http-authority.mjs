// Isolated authenticated, Mongo-transactional two-message conversation HTTP authority.
// Diagnostic only. Not imported by the application or deployed.
import {createServer} from 'node:http';
import {verify,createPublicKey} from 'node:crypto';
import {validateConversationSettlement} from './isolated-conversation-settlement-contract.mjs';
const parseToken=(header,key)=>{
 try{
  if(typeof header!=='string'||!header.startsWith('Bearer '))return null;
  const parts=header.slice(7).split('.');if(parts.length!==3)return null;
  const h=JSON.parse(Buffer.from(parts[0],'base64url')),p=JSON.parse(Buffer.from(parts[1],'base64url'));
  if(h.alg!=='RS256'||p.iss!=='https://isolated-auth.test'||p.aud!=='movie-mentor-creator-write'||typeof p.sub!=='string'||!p.sub)return null;
  const now=Math.floor(Date.now()/1000);
  if(!Number.isFinite(p.exp)||p.exp<=now||p.nbf>now)return null;
  return verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),key,Buffer.from(parts[2],'base64url'))?p.sub:null;
 }catch{return null}
};
export function createIsolatedConversationHttpAuthority({db,client,publicKey,dropAfterCommitOperationId=null}={}){
 if(!db||!client||!publicKey)throw Error('durable-authority-required');
 const key=typeof publicKey==='string'?createPublicKey(publicKey):publicKey;
 const projects=db.collection('projects'),receipts=db.collection('receipts');
 const http=createServer(async(req,res)=>{
  const reply=(status,data)=>{if(res.writableEnded||res.destroyed)return;res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data))};
  if(req.method!=='POST'||!['/conversation/settle','/conversation/read','/conversation/receipt'].includes(req.url))return reply(404,{error:'not-found'});
  const owner=parseToken(req.headers.authorization,key);
  if(!owner)return reply(401,{error:'unauthorized'});
  try{
   let raw='';for await(const chunk of req){raw+=chunk.toString();if(Buffer.byteLength(raw)>128*1024)return reply(413,{error:'body-too-large'})}
   const input=JSON.parse(raw);
   if(!input||typeof input.projectId!=='string'||!input.projectId)return reply(400,{error:'invalid-request'});
   if(req.url==='/conversation/settle'){
    const valid=validateConversationSettlement(input);
    const session=client.startSession();
    let outcome;
    try{
     outcome=await session.withTransaction(async()=>{
      const project=await projects.findOne({_id:valid.projectId},{session});
      if(!project||project.ownerId!==owner)return {status:403,error:'owner-denied'};
      const prior=await receipts.findOne({projectId:valid.projectId,operationId:valid.operationId},{session});
      if(prior){
       if(JSON.stringify(prior.input)!==JSON.stringify(valid))return {status:409,error:'replay-conflict'};
       return {status:200,receipt:prior.receipt};
      }
      if(project.revision!==valid.expectedRevision)return {status:409,error:'stale-revision'};
      if(await receipts.findOne({projectId:valid.projectId,creatorTurnId:valid.creatorTurnId},{session}))return {status:409,error:'duplicate-turn'};
      const receipt={projectId:valid.projectId,operationId:valid.operationId,creatorTurnId:valid.creatorTurnId,serverCommitId:'atomic-'+valid.operationId,committedRevision:project.revision+1};
      const result=await projects.updateOne({_id:valid.projectId,ownerId:owner,revision:valid.expectedRevision},{$inc:{revision:1},$push:{conversation:{$each:[valid.creatorMessage,valid.mentorMessage]}}},{session});
      if(result.modifiedCount!==1)throw Error('concurrent-writer-denied');
      await receipts.insertOne({projectId:valid.projectId,operationId:valid.operationId,creatorTurnId:valid.creatorTurnId,input:valid,receipt},{session});
      return {status:200,receipt};
     },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'}});
    }finally{await session.endSession()}
    if(outcome.status===200&&valid.operationId===dropAfterCommitOperationId){req.socket.destroy();return}
    return reply(outcome.status,outcome.receipt||{error:outcome.error});
   }
   const project=await projects.findOne({_id:input.projectId});
   if(!project||project.ownerId!==owner)return reply(403,{error:'owner-denied'});
   if(req.url==='/conversation/read')return reply(200,{projectId:input.projectId,revision:project.revision,conversation:project.conversation});
   if(typeof input.operationId!=='string'||!input.operationId)return reply(400,{error:'operation-required'});
   const found=await receipts.findOne({projectId:input.projectId,operationId:input.operationId});
   return found?reply(200,found.receipt):reply(404,{error:'receipt-not-found'});
  }catch(error){return reply(400,{error:'request-denied',message:String(error.message||error)})}
 });
 return {server:http,projects,receipts};
}
