// Isolated, server-owned writable-admission gate. NOT wired to application facade.
import {createHash,verify,randomUUID} from 'node:crypto';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function subject(token,key){try{const [h,p,s,...extra]=token.split('.');if(extra.length)return null;const header=JSON.parse(Buffer.from(h,'base64url')),claims=JSON.parse(Buffer.from(p,'base64url')),now=Math.floor(Date.now()/1000);return header.alg==='RS256'&&header.typ==='JWT'&&verify('RSA-SHA256',Buffer.from(h+'.'+p),key,Buffer.from(s,'base64url'))&&claims.iss==='https://isolated-auth.test'&&claims.aud==='movie-mentor-creator-write'&&typeof claims.sub==='string'&&claims.sub&&Number.isInteger(claims.iat)&&claims.iat<=now&&Number.isInteger(claims.nbf)&&claims.nbf<=now&&Number.isInteger(claims.exp)&&claims.exp>now?claims.sub:null}catch{return null}}
export function createWritableAdmissionGate({db,client,publicKey}){
 const states=db.collection('provenance_states'),ledger=db.collection('server_publication_ledger'),grants=db.collection('provenance_adoption_grants'),admissions=db.collection('server_writable_admissions');
 async function validate({session,projectId,ownerId,revision}){
  const state=await states.findOne({projectId,ownerId,revision,revoked:false},{session});
  if(!state||!Array.isArray(state.state?.durablePublicationOutbox)||!state.state.durablePublicationOutbox.length)return null;
  const records=await ledger.find({projectId,ownerId,ownershipRevision:state.ownershipRevision,revision:{$lte:revision}},{session}).sort({revision:1}).toArray();
  const outbox=state.state.durablePublicationOutbox;
  if(records.length!==outbox.length||records.some((r,i)=>hash(r.entry)!==hash(outbox[i]))||records.at(-1)?.fullOutboxDigest!==hash(outbox)||records.at(-1)?.stateDigest!==hash(state.state))return null;
  return state;
 }
 async function admit({token,projectId,grantId,operationId,revision}){
  const ownerId=subject(token,publicKey);
  if(!ownerId||!projectId||!grantId||!operationId||!Number.isSafeInteger(revision))return {acquired:false};
  const session=client.startSession();let receipt={acquired:false};
  try{
   await session.withTransaction(async()=>{
    const state=await validate({session,projectId,ownerId,revision});if(!state||state.activeAdoptionGrant)return;
    const grant=await grants.findOne({projectId,grantId,ownerId,revision,ownershipRevision:state.ownershipRevision,status:'issued',stateDigest:hash(state.state),outboxDigest:hash(state.state.durablePublicationOutbox)},{session});if(!grant)return;
    const fence=randomUUID(),updated=await states.updateOne({projectId,ownerId,revision,ownershipRevision:state.ownershipRevision,revoked:false,activeAdoptionGrant:{$exists:false}},{$set:{activeAdoptionGrant:grantId,activeWriterFence:fence}},{session});
    if(updated.matchedCount!==1)throw Error('writable-admission-race');
    await grants.updateOne({projectId,grantId,status:'issued'},{$set:{status:'consumed'}},{session});
    await admissions.insertOne({projectId,operationId,grantId,ownerId,revision,ownershipRevision:state.ownershipRevision,fence,stateDigest:hash(state.state),outboxDigest:hash(state.state.durablePublicationOutbox),status:'admitted'},{session});
    receipt={acquired:true,projectId,operationId,revision,fence,state:structuredClone(state.state)};
   },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'}});
  }catch(e){if(!e?.hasErrorLabel?.('TransientTransactionError')&&e?.code!==112&&e?.code!==11000)throw e}
  finally{await session.endSession()}
  return receipt;
 }
 async function readAdmission({token,projectId,operationId,fence}){
  const ownerId=subject(token,publicKey);if(!ownerId||!fence)return null;
  const a=await admissions.findOne({projectId,operationId,ownerId,fence,status:'admitted'});if(!a)return null;
  const state=await validate({projectId,ownerId,revision:a.revision});
  if(!state||state.ownershipRevision!==a.ownershipRevision||state.activeAdoptionGrant!==a.grantId||state.activeWriterFence!==fence||hash(state.state)!==a.stateDigest||hash(state.state.durablePublicationOutbox)!==a.outboxDigest)return null;
  return {projectId,operationId,revision:a.revision,fence,state:structuredClone(state.state)};
 }
 return {states,ledger,grants,admissions,admit,readAdmission,authenticateOwner:token=>subject(token,publicKey)};
}
