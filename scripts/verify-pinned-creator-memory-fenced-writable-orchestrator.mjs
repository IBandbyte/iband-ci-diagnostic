// Fresh-process real CreatorMemory facade + physical Mongo fenced writable adoption court.
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const now=Math.floor(Date.now()/1000),b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
function jwt(sub){const data=b64({alg:'RS256',typ:'JWT'})+'.'+b64({iss:'https://isolated-auth.test',aud:'movie-mentor-creator-write',sub,iat:now,nbf:now-1,exp:now+600});return data+'.'+sign('RSA-SHA256',Buffer.from(data),privateKey).toString('base64url')}
const env={...process.env,PUBLIC_KEY_PEM:publicKey.export({type:'spki',format:'pem'}),OWNER_TOKEN:jwt('owner-1'),INTRUDER_TOKEN:jwt('intruder')};
for(const phase of ['seed','first','second','restart','revoke']){
 const run=spawnSync(process.execPath,['./verify-pinned-creator-memory-fenced-writable-worker.mjs',phase],{encoding:'utf8',env,timeout:90000});
 process.stdout.write(run.stdout||'');process.stderr.write(run.stderr||'');
 assert.equal(run.status,0,'real facade fenced writable phase '+phase+' failed '+run.error?.message);
}
console.log('GREEN PINNED_CREATOR_MEMORY_PHYSICAL_FENCED_WRITABLE_ADOPTION_AND_RESTART');
console.log('HELD ORIGINAL_FRONTEND_RED_AND_REAL_APPLICATION_WRITABLE_PUBLISHING');
