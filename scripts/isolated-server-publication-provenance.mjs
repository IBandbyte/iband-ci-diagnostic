// Diagnostic-only physical Mongo server-owned publication provenance, no app wiring.
import {createHash,randomUUID,verify} from 'node:crypto';
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function owner(token,key){try{const p=token.split('.');if(p.length!==3)return null;const h=JSON.parse(Buffer.from(p[0],'base64url')),c=JSON.parse(Buffer.from(p[1],'base64url')),n=Math.floor(Date.now()/1000);return h.alg==='RS256'&&h.typ==='JWT'&&verify('RSA-SHA256',Buffer.from(p[0]+'.'+p[1]),key,Buffer.from(p[2],'base64url'))&&c.iss==='https://isolated-auth.test'&&c.aud==='movie-mentor-creator-write'&&typeof c.sub==='string'&&c.sub&&Number.isInteger(c.iat)&&c.iat<=n&&Number.isInteger(c.nbf)&&c.nbf<=n&&Number.isInteger(c.exp)&&c.exp>n?c.sub:null}catch{return null}}
export function createProvenanceAuthority({db,client,publicKey}){
 const states=db.collection('provenance_states'),ledger=db.collection('server_publication_ledger'),grants=db.collection('provenance_adoption_grants');
 async function append({token,projectId,operationId,expectedRevision,content}){
  const sub=owner(token,publicKey);if(!sub||!operationId||!projectId||!Number.isSafeInteger(expectedRevision))return {ok:false};
  const session=client.startSession();
  try{let result={ok:false};await session.withTransaction(async()=>{
   const s=await states.findOne({projectId,ownerId:sub,revoked:false,revision:expectedRevision},{session});if(!s)return;
   const prior=await ledger.findOne({projectId,operationId},{session});if(prior)return;
   const outbox=[...s.state.durablePublicationOutbox];
   const entry={id:randomUUID(),status:'pending',committedStateVersion:outbox.length+1,snapshotDigest:digest({content,revision:expectedRevision+1})};
   const next={content,durablePublicationOutbox:[...outbox,entry]};
   const record={projectId,operationId,ownerId:sub,ownershipRevision:s.ownershipRevision,revision:expectedRevision+1,entry,fullOutboxDigest:digest(next.durablePublicationOutbox),stateDigest:digest(next)};
   const changed=await states.updateOne({projectId,ownerId:sub,revision:expectedRevision,revoked:false},{$set:{revision:expectedRevision+1,state:next}},{session});
   if(changed.matchedCount!==1)throw Error('revision race');
   await ledger.insertOne(record,{session});result={ok:true,revision:record.revision,entryId:entry.id};
  },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'}});return result;
  }finally{await session.endSession()}
 }
 async function issue({token,projectId,revision}){
  const sub=owner(token,publicKey);if(!sub)return null;
  const s=await states.findOne({projectId,ownerId:sub,revoked:false,revision});if(!s||!s.state?.durablePublicationOutbox?.length)return null;
  const entries=await ledger.find({projectId,ownerId:sub,ownershipRevision:s.ownershipRevision,revision:{$lte:revision}}).sort({revision:1}).toArray();
  if(entries.length!==s.state.durablePublicationOutbox.length||entries.some((e,i)=>digest(e.entry)!==digest(s.state.durablePublicationOutbox[i])))return null;
  if(entries.at(-1)?.fullOutboxDigest!==digest(s.state.durablePublicationOutbox)||entries.at(-1)?.stateDigest!==digest(s.state))return null;
  const grantId=randomUUID();await grants.insertOne({grantId,projectId,ownerId:sub,revision,ownershipRevision:s.ownershipRevision,stateDigest:digest(s.state),outboxDigest:digest(s.state.durablePublicationOutbox),status:'issued'});
  return {grantId};
 }
 async function consume({token,projectId,grantId}){
  const sub=owner(token,publicKey);if(!sub)return false;const session=client.startSession();
  try{let ok=false;await session.withTransaction(async()=>{
   const g=await grants.findOne({grantId,projectId,ownerId:sub,status:'issued'},{session});if(!g)return;
   const s=await states.findOne({projectId,ownerId:sub,revoked:false,revision:g.revision,ownershipRevision:g.ownershipRevision,activeAdoptionGrant:{$exists:false}},{session});
   if(!s||digest(s.state)!==g.stateDigest||digest(s.state.durablePublicationOutbox)!==g.outboxDigest)return;
   const records=await ledger.find({projectId,ownerId:sub,ownershipRevision:g.ownershipRevision,revision:{$lte:g.revision}},{session}).sort({revision:1}).toArray();
   if(records.length!==s.state.durablePublicationOutbox.length||records.some((r,i)=>digest(r.entry)!==digest(s.state.durablePublicationOutbox[i]))||records.at(-1)?.stateDigest!==g.stateDigest)return;
   const u=await states.updateOne({projectId,revision:g.revision,activeAdoptionGrant:{$exists:false}},{$set:{activeAdoptionGrant:grantId}},{session});if(u.matchedCount!==1)return;
   await grants.updateOne({grantId,status:'issued'},{$set:{status:'consumed'}},{session});ok=true;
  },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'}});return ok;
  }catch(e){if(e?.hasErrorLabel?.('TransientTransactionError')||e?.code===112)return false;throw e}finally{await session.endSession()}
 }
 return {states,ledger,grants,append,issue,consume};
}
