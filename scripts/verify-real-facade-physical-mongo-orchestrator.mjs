import {generateKeyPairSync,sign} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const now=Math.floor(Date.now()/1000);
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
function jwt(sub){
 const data=`${b64({alg:'RS256',typ:'JWT'})}.${b64({iss:'https://isolated-auth.test',aud:'movie-mentor-creator-write',sub,iat:now,nbf:now-1,exp:now+300})}`;
 return `${data}.${sign('RSA-SHA256',Buffer.from(data),privateKey).toString('base64url')}`;
}
const env={...process.env,PUBLIC_KEY_PEM:publicKey.export({type:'spki',format:'pem'}),OWNER_TOKEN:jwt('owner-1'),INTRUDER_TOKEN:jwt('intruder')};
for(const phase of ['seed','replay','deny']){
 const child=spawnSync(process.execPath,['./verify-real-facade-physical-mongo-worker.mjs',phase],{env,encoding:'utf8',timeout:45000});
 process.stdout.write(child.stdout||'');
 process.stderr.write(child.stderr||'');
 if(child.error||child.status!==0)throw Error(`Independent process ${phase} failed: ${child.error?.message||child.status}`);
}
console.log('GREEN THREE_INDEPENDENT_PROCESSES_REAL_CREATOR_MEMORY_FACADE_PHYSICAL_MONGO');
console.log('HELD LOCAL_STATE_ADOPTION_AND_ORIGINAL_CONTINUITY_RED');
