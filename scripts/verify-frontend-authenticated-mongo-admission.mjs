// Isolated authenticated admission court. This does not bypass CreatorMemory provenance.
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,verify,randomUUID} from 'node:crypto';
import {MongoClient} from 'mongodb';
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const issuer='https://isolated-auth.test',audience='movie-mentor-creator-write';
const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const issue=(sub,overrides={})=>{
 const now=Math.floor(Date.now()/1000);
 const body={iss:issuer,aud:audience,sub,iat:now,nbf:now-1,exp:now+120,jti:randomUUID(),...overrides};
 const signingInput=`${encode({alg:'RS256',typ:'JWT'})}.${encode(body)}`;
 return `${signingInput}.${sign('RSA-SHA256',Buffer.from(signingInput),privateKey).toString('base64url')}`;
};
function authenticate(token){
 try{
  const parts=token.split('.');
  if(parts.length!==3)return null;
  const header=JSON.parse(Buffer.from(parts[0],'base64url'));
  if(header.alg!=='RS256'||header.typ!=='JWT')return null;
  if(!verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),publicKey,Buffer.from(parts[2],'base64url')))return null;
  const c=JSON.parse(Buffer.from(parts[1],'base64url')),now=Math.floor(Date.now()/1000);
  if(c.iss!==issuer||c.aud!==audience||typeof c.sub!=='string'||!c.sub||!Number.isInteger(c.exp)||c.exp<=now||!Number.isInteger(c.nbf)||c.nbf>now||!Number.isInteger(c.iat)||c.iat>now)return null;
  return c.sub;
 }catch{return null;}
}
const client=new MongoClient(process.env.MONGO_URI,{serverSelectionTimeoutMS:12000});
await client.connect();
try{
 const db=client.db('movie_mentor_authenticated_admission_isolated');
 const projects=db.collection('projects');
 await projects.deleteMany({projectId:'jwt-auth-court'});
 await projects.insertOne({projectId:'jwt-auth-court',ownerId:'owner-1',ownershipRevision:1,revision:1});
 async function authorize(token,expectedRevision,expectedOwnershipRevision){
  const principal=authenticate(token);
  if(!principal)return false;
  const project=await projects.findOne({projectId:'jwt-auth-court',ownerId:principal,revision:expectedRevision,ownershipRevision:expectedOwnershipRevision});
  return Boolean(project);
 }
 const owner=issue('owner-1');
 assert.equal(await authorize(owner,1,1),true);
 assert.equal(await authorize(issue('intruder'),1,1),false);
 assert.equal(await authorize(issue('owner-1',{aud:'wrong'}),1,1),false);
 assert.equal(await authorize(issue('owner-1',{iss:'https://evil.test'}),1,1),false);
 assert.equal(await authorize(issue('owner-1',{exp:0}),1,1),false);
 assert.equal(await authorize(issue('owner-1',{nbf:Math.floor(Date.now()/1000)+300}),1,1),false);
 const pieces=owner.split('.');
 const forged=[pieces[0],encode({...JSON.parse(Buffer.from(pieces[1],'base64url')),sub:'intruder'}),pieces[2]].join('.');
 assert.equal(await authorize(forged,1,1),false);
 assert.equal(await authorize(owner,0,1),false);
 await projects.updateOne({projectId:'jwt-auth-court',ownerId:'owner-1',ownershipRevision:1},{$set:{ownerId:'new-owner',ownershipRevision:2}});
 assert.equal(await authorize(owner,1,1),false);
 assert.equal(await authorize(issue('new-owner'),1,1),false);
 assert.equal(await authorize(issue('new-owner'),1,2),true);
 console.log('GREEN PHYSICAL_RS256_AUTHENTICATION_OWNER_REVISION_REVOCATION_DENIAL');
 console.log('HELD AUTHENTICATED_ADMISSION_NOT_WIRED_TO_CREATOR_MEMORY_WRITER');
}finally{await client.close();}
