// Isolated server-side Mongo authority adapter; never import into a browser.
// Production integration is intentionally not wired or certified.
import {createHash,verify} from 'node:crypto';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const readJwt=(token,publicKey,{issuer,audience})=>{
 try{
  const p=token.split('.');
  if(p.length!==3)return null;
  const h=JSON.parse(Buffer.from(p[0],'base64url'));
  if(h.alg!=='RS256'||h.typ!=='JWT')return null;
  if(!verify('RSA-SHA256',Buffer.from(p[0]+'.'+p[1]),publicKey,Buffer.from(p[2],'base64url')))return null;
  const c=JSON.parse(Buffer.from(p[1],'base64url')),now=Math.floor(Date.now()/1000);
  if(c.iss!==issuer||c.aud!==audience||typeof c.sub!=='string'||!c.sub||
    !Number.isInteger(c.iat)||c.iat>now||!Number.isInteger(c.nbf)||c.nbf>now||
    !Number.isInteger(c.exp)||c.exp<=now)return null;
  return c.sub;
 }catch{return null;}
};
function createIsolatedMongoCreatorAuthority({db,publicKey,issuer,audience}){
 const states=db.collection('creator_authority_states'),operations=db.collection('creator_authority_operations');
 const principal=token=>readJwt(token,publicKey,{issuer,audience});
 async function commit({authenticatedSession,projectId,operationId,expectedRevision,proposedState}){
  const sub=principal(authenticatedSession);
  if(!sub||!projectId||!operationId||!Number.isSafeInteger(expectedRevision)||expectedRevision<0||
     !proposedState||typeof proposedState!=='object'||Array.isArray(proposedState))return {status:'denied'};
  const requestDigest=digest({projectId,operationId,expectedRevision,proposedState});
  const session=db.client.startSession();
  try{
   return await session.withTransaction(async()=>{
    const current=await states.findOne({projectId},{session});
    if(!current||current.ownerId!==sub||current.revoked===true)return {status:'denied'};
    const previous=await operations.findOne({projectId,operationId},{session});
    if(previous){
     if(previous.ownerId!==sub||previous.requestDigest!==requestDigest)return {status:'conflict'};
     return {status:'committed',projectId,operationId,committedRevision:previous.committedRevision,serverCommitId:previous.serverCommitId};
    }
    if(current.revision!==expectedRevision)return {status:'stale'};
    // The publication outbox is server-owned. Never accept client-supplied
    // additions, deletions or rewrites of its durable provenance metadata.
    if(digest(proposedState.durablePublicationOutbox??[])!==digest(current.state.durablePublicationOutbox??[]))return {status:'publication-provenance-denied'};
    const committedRevision=current.revision+1;
    const serverCommitId=digest({projectId,operationId,requestDigest,committedRevision,ownershipRevision:current.ownershipRevision});
    const update=await states.updateOne({projectId,ownerId:sub,revoked:false,revision:expectedRevision,ownershipRevision:current.ownershipRevision},{$set:{revision:committedRevision,state:proposedState}},{session});
    if(update.matchedCount!==1)return {status:'stale'};
    await operations.insertOne({projectId,operationId,ownerId:sub,requestDigest,committedRevision,serverCommitId,state:proposedState},{session});
    return {status:'committed',projectId,operationId,committedRevision,serverCommitId};
   },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'}});
  }finally{await session.endSession();}
 }
 async function readCommitted({authenticatedSession,projectId,operationId}){
  const sub=principal(authenticatedSession);
  if(!sub)return null;
  const owner=await states.findOne({projectId,ownerId:sub,revoked:false});
  if(!owner)return null;
  const op=await operations.findOne({projectId,operationId,ownerId:sub});
  if(!op)return null;
  return {projectId,operationId,committedRevision:op.committedRevision,serverCommitId:op.serverCommitId,state:op.state};
 }
 return {commit,readCommitted,states,operations};
}
export {createIsolatedMongoCreatorAuthority};
