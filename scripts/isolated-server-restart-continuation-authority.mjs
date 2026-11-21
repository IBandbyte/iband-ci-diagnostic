// Diagnostic-only server-owned positive continuation after a durable adoption grant.
// The local CreatorMemory outbox or browser-supplied digest grants NO write permission.
import {createHash,verify} from 'node:crypto';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function subject(token,key){
 try{
  const p=token.split('.');if(p.length!==3)return null;
  const h=JSON.parse(Buffer.from(p[0],'base64url')),c=JSON.parse(Buffer.from(p[1],'base64url'));
  const now=Math.floor(Date.now()/1000);
  if(h.alg!=='RS256'||h.typ!=='JWT'||c.iss!=='https://isolated-auth.test'||c.aud!=='movie-mentor-creator-write'||typeof c.sub!=='string'||!c.sub||!Number.isInteger(c.iat)||c.iat>now||!Number.isInteger(c.nbf)||c.nbf>now||!Number.isInteger(c.exp)||c.exp<=now)return null;
  return verify('RSA-SHA256',Buffer.from(p[0]+'.'+p[1]),key,Buffer.from(p[2],'base64url'))?c.sub:null;
 }catch{return null}
}
export function createRestartContinuationAuthority({db,client,publicKey}){
 const states=db.collection('provenance_states'),ledger=db.collection('server_publication_ledger'),grants=db.collection('provenance_adoption_grants'),effects=db.collection('restart_continuation_effects');
 async function continueNextScene({token,projectId,grantId,operationId,expectedRevision,nextScene}={}){
  const owner=subject(token,publicKey);
  if(!owner||!projectId||!grantId||!operationId||!Number.isSafeInteger(expectedRevision)||expectedRevision<0||!nextScene?.id||typeof nextScene?.text!=='string')return {status:'denied'};
  const session=client.startSession();
  try{
   let outcome={status:'denied'};
   await session.withTransaction(async()=>{
    const g=await grants.findOne({grantId,projectId,ownerId:owner,status:'consumed'},{session});
    if(!g||g.revision!==expectedRevision)return;
    const state=await states.findOne({projectId,ownerId:owner,revoked:false,ownershipRevision:g.ownershipRevision,activeAdoptionGrant:grantId},{session});
    if(!state)return;
    const previous=await effects.findOne({projectId,operationId},{session});
    if(previous){
     if(previous.ownerId===owner&&previous.grantId===grantId&&previous.expectedRevision===expectedRevision&&hash(previous.nextScene)===hash(nextScene)){outcome={status:'replayed',receipt:previous.receipt};}
     return;
    }
    if(state.revision!==expectedRevision)return;
    if(hash(state.state)!==g.stateDigest||hash(state.state.durablePublicationOutbox)!==g.outboxDigest)return;
    const list=await ledger.find({projectId,ownerId:owner,ownershipRevision:g.ownershipRevision,revision:{$lte:expectedRevision}},{session}).sort({revision:1}).toArray();
    if(list.length!==state.state.durablePublicationOutbox.length||list.some((e,i)=>hash(e.entry)!==hash(state.state.durablePublicationOutbox[i]))||list.at(-1)?.stateDigest!==g.stateDigest)return;
    const next={...state.state,content:{...state.state.content,scenes:[...(state.state.content.scenes||[]),nextScene]}};
    const receipt={projectId,operationId,committedRevision:expectedRevision+1,serverCommitId:'restart-'+operationId};
    const written=await states.updateOne({projectId,ownerId:owner,revoked:false,revision:expectedRevision,activeAdoptionGrant:grantId},{$set:{revision:receipt.committedRevision,state:next},$unset:{activeAdoptionGrant:''}},{session});
    if(written.modifiedCount!==1)throw Error('restart-writer-cas-failed');
    await effects.insertOne({projectId,operationId,ownerId:owner,grantId,expectedRevision,nextScene,receipt},{session});
    outcome={status:'committed',receipt};
   },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'}});
   return outcome;
  }catch(error){if(error?.hasErrorLabel?.('TransientTransactionError')||error?.code===112||error?.code===11000)return {status:'denied'};throw error;}
  finally{await session.endSession();}
 }
 async function read({token,projectId}={}){
  const owner=subject(token,publicKey);if(!owner)return {status:'denied'};
  const state=await states.findOne({projectId,ownerId:owner,revoked:false});
  return state?{status:'ok',revision:state.revision,state:state.state}:{status:'denied'};
 }
 return {continueNextScene,read,effects,states,grants};
}
