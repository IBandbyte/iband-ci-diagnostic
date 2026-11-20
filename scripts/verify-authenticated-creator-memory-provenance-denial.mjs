// Negative integration: a valid independently authenticated Mongo owner must NOT
// bypass CreatorMemory's unwitnessed publication provenance after facade restart.
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,verify} from 'node:crypto';
import {MongoClient} from 'mongodb';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {default:createCreatorMemory,createMemoryStorageAdapter}=await import(pathToFileURL(resolve('../frontend/src/components/studio/mentor/CreatorMemory.js')).href);
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const now=Math.floor(Date.now()/1000);
const claims={iss:'https://isolated-auth.test',aud:'movie-mentor-creator-write',sub:'owner-1',iat:now,nbf:now-1,exp:now+90};
const input=`${b64({alg:'RS256',typ:'JWT'})}.${b64(claims)}`;
const token=`${input}.${sign('RSA-SHA256',Buffer.from(input),privateKey).toString('base64url')}`;
function authenticate(jwt){
 try{
  const p=jwt.split('.');
  if(p.length!==3||JSON.parse(Buffer.from(p[0],'base64url')).alg!=='RS256')return null;
  if(!verify('RSA-SHA256',Buffer.from(p[0]+'.'+p[1]),publicKey,Buffer.from(p[2],'base64url')))return null;
  const c=JSON.parse(Buffer.from(p[1],'base64url')),t=Math.floor(Date.now()/1000);
  return c.iss==='https://isolated-auth.test'&&c.aud==='movie-mentor-creator-write'&&c.nbf<=t&&c.iat<=t&&c.exp>t?c.sub:null;
 }catch{return null;}
}
const client=new MongoClient(process.env.MONGO_URI,{serverSelectionTimeoutMS:12000});
await client.connect();
try{
 const projects=client.db('movie_mentor_auth_guard_integration_isolated').collection('projects');
 await projects.deleteMany({projectId:'auth-guard-film'});
 await projects.insertOne({projectId:'auth-guard-film',ownerId:'owner-1',ownershipRevision:1,revision:1});
 const storage=createMemoryStorageAdapter();
 const locks={request:async(name,opts,cb)=> (typeof opts==='function'?opts:cb)({name,mode:'exclusive'})};
 const initial=createCreatorMemory({storageAdapter:storage,requireSharedWriteAuthority:true});
 const first=await initial.replaceStateWithSharedAuthority({locks,transform:state=>({...state,journey:{...state.journey,activeProjectId:'auth-guard-film'}})});
 assert.equal(first.acquired,true,'Initial witnessed publication must succeed');
 const restarted=createCreatorMemory({storageAdapter:storage,requireSharedWriteAuthority:true});
 const persistedBefore=JSON.stringify(restarted.getState());
 const authorized=async(jwt,ownerRevision,revision)=>{
  const principal=authenticate(jwt);
  return Boolean(principal&&await projects.findOne({projectId:'auth-guard-film',ownerId:principal,ownershipRevision:ownerRevision,revision}));
 };
 assert.equal(await authorized(token,1,1),true,'Real signed owner must pass isolated admission');
 const attempted=await restarted.replaceStateWithSharedAuthority({locks,transform:state=>({...state,journey:{...state.journey,activeProjectId:null}})});
 assert.equal(attempted.acquired,false,'Authenticated admission must not silently bypass unwitnessed outbox');
 assert.equal(attempted.reason,'publication-outbox-provenance-unverified');
 assert.equal(JSON.stringify(restarted.getState()),persistedBefore);
 const parts=token.split('.');
 const forgedClaims={...JSON.parse(Buffer.from(parts[1],'base64url')),sub:'intruder'};
 const forged=[parts[0],b64(forgedClaims),parts[2]].join('.');
 assert.equal(await authorized(forged,1,1),false,'Modified signed claims must fail signature verification');
 await projects.updateOne({projectId:'auth-guard-film'},{$set:{ownerId:'new-owner',ownershipRevision:2}});
 assert.equal(await authorized(token,1,1),false);
 assert.equal(JSON.stringify(restarted.getState()),persistedBefore);
 console.log('GREEN AUTHENTICATED_MONGO_ADMISSION_WITH_REAL_CREATOR_MEMORY_PROVENANCE_DENIAL');
 console.log('HELD POSITIVE_AUTHORIZED_RESTART_WRITER_NOT_IMPLEMENTED');
}finally{await client.close();}
