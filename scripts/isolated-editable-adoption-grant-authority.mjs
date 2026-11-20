// Isolated diagnostic-only grant authority. Empty outbox ONLY. Not production.
import {randomUUID,createHash,verify} from 'node:crypto';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function principal(token,key){try{const p=token.split('.');if(p.length!==3)return null;const h=JSON.parse(Buffer.from(p[0],'base64url'));const c=JSON.parse(Buffer.from(p[1],'base64url'));const now=Math.floor(Date.now()/1000);if(h.alg!=='RS256'||h.typ!=='JWT'||!verify('RSA-SHA256',Buffer.from(p[0]+'.'+p[1]),key,Buffer.from(p[2],'base64url'))||c.iss!=='https://isolated-auth.test'||c.aud!=='movie-mentor-creator-write'||!c.sub||c.iat>now||c.nbf>now||c.exp<=now)return null;return c.sub}catch{return null}}
export function createGrantAuthority({db,client,publicKey}){
 const states=db.collection('creator_authority_states'),grants=db.collection('editable_adoption_grants');
 async function issue({token,projectId,revision}){
  const owner=principal(token,publicKey);if(!owner||!projectId||!Number.isSafeInteger(revision))return null;
  const s=await states.findOne({projectId,ownerId:owner,revoked:false,revision});
  if(!s||!Array.isArray(s.state?.durablePublicationOutbox)||s.state.durablePublicationOutbox.length!==0)return null;
  const grantId=randomUUID(),outboxDigest=hash([]),stateDigest=hash(s.state);
  const record={grantId,projectId,ownerId:owner,ownershipRevision:s.ownershipRevision,revision,stateDigest,outboxDigest,purpose:'editable-adoption',status:'issued',expiresAt:new Date(Date.now()+60000)};
  await grants.insertOne(record);return {grantId,projectId,revision};
 }
 async function consume({token,grantId,projectId}){
  const owner=principal(token,publicKey);if(!owner||!grantId||!projectId)return {acquired:false,reason:'unauthorized'};
  const session=client.startSession();
  try{
   let result={acquired:false,reason:'denied'};
   await session.withTransaction(async()=>{
    const g=await grants.findOne({grantId,projectId,ownerId:owner,purpose:'editable-adoption',status:'issued',expiresAt:{$gt:new Date()}},{session});
    if(!g)return;
    const s=await states.findOne({projectId,ownerId:owner,revoked:false,revision:g.revision,ownershipRevision:g.ownershipRevision},{session});
    if(!s||!Array.isArray(s.state?.durablePublicationOutbox)||s.state.durablePublicationOutbox.length!==0||hash(s.state)!==g.stateDigest||hash([])!==g.outboxDigest)return;
    // One winner for this revision, across independent processes.
    const claimed=await states.updateOne({projectId,ownerId:owner,revision:g.revision,ownershipRevision:g.ownershipRevision,revoked:false,activeAdoptionGrant:{$exists:false}},{$set:{activeAdoptionGrant:grantId}},{session});
    if(claimed.matchedCount!==1)return;
    const consumed=await grants.updateOne({grantId,status:'issued'},{$set:{status:'consumed',consumedAt:new Date()}},{session});
    if(consumed.matchedCount!==1)throw Error('grant race');
    result={acquired:true,grantId,revision:g.revision};
   },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'}});
   return result;
  }catch(e){if(e?.hasErrorLabel?.('TransientTransactionError')||e?.code===112||e?.message==='grant race')return {acquired:false,reason:'concurrent-denial'};throw e}
  finally{await session.endSession()}
 }
 return {issue,consume,states,grants};
}
