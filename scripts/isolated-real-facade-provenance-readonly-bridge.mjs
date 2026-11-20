// Diagnostic-only read-only continuation bridge; not a writable adoption grant.
import {createHash,randomUUID,verify} from 'node:crypto';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function principal(token,key){try{const p=token.split('.');if(p.length!==3)return null;const h=JSON.parse(Buffer.from(p[0],'base64url')),c=JSON.parse(Buffer.from(p[1],'base64url')),n=Math.floor(Date.now()/1000);return h.alg==='RS256'&&h.typ==='JWT'&&verify('RSA-SHA256',Buffer.from(p[0]+'.'+p[1]),key,Buffer.from(p[2],'base64url'))&&c.iss==='https://isolated-auth.test'&&c.aud==='movie-mentor-creator-write'&&c.sub&&c.iat<=n&&c.nbf<=n&&c.exp>n?c.sub:null}catch{return null}}
export function createReadOnlyProvenanceBridge({db,client,publicKey}){
 const states=db.collection('provenance_states'),ledger=db.collection('server_publication_ledger'),operations=db.collection('provenance_read_only_continuations');
 async function commit({authenticatedSession,projectId,operationId,expectedRevision,proposedState}){
  const owner=principal(authenticatedSession,publicKey);if(!owner||!operationId||!projectId)return null;
  const session=client.startSession();let result=null;
  try{await session.withTransaction(async()=>{
   const prior=await operations.findOne({projectId,operationId},{session});
   if(prior){if(prior.ownerId===owner&&prior.stateDigest===hash(proposedState))result={status:'committed',projectId,operationId,committedRevision:prior.revision,serverCommitId:prior.commitId};return}
   const s=await states.findOne({projectId,ownerId:owner,revoked:false,revision:expectedRevision},{session});
   if(!s||!Array.isArray(s.state?.durablePublicationOutbox)||!s.state.durablePublicationOutbox.length||hash(s.state)!==hash(proposedState))return;
   const entries=await ledger.find({projectId,ownerId:owner,ownershipRevision:s.ownershipRevision,revision:{$lte:expectedRevision}},{session}).sort({revision:1}).toArray();
   if(entries.length!==s.state.durablePublicationOutbox.length||entries.some((e,i)=>hash(e.entry)!==hash(s.state.durablePublicationOutbox[i]))||entries.at(-1)?.stateDigest!==hash(s.state)||entries.at(-1)?.fullOutboxDigest!==hash(s.state.durablePublicationOutbox))return;
   const commitId=randomUUID();await operations.insertOne({projectId,operationId,ownerId:owner,revision:expectedRevision,commitId,stateDigest:hash(s.state),state:structuredClone(s.state)},{session});
   result={status:'committed',projectId,operationId,committedRevision:expectedRevision,serverCommitId:commitId};
  },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'}});return result;
  }finally{await session.endSession()}
 }
 async function readCommitted({authenticatedSession,projectId,operationId}){
  const owner=principal(authenticatedSession,publicKey);if(!owner)return null;
  const o=await operations.findOne({projectId,operationId,ownerId:owner});if(!o)return null;
  const s=await states.findOne({projectId,ownerId:owner,revoked:false,revision:o.revision});if(!s||hash(s.state)!==o.stateDigest)return null;
  return {projectId,operationId,committedRevision:o.revision,serverCommitId:o.commitId,state:structuredClone(o.state)};
 }
 return {commit,readCommitted,operations};
}
