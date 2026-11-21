// Independent physical mounted REAL React handler migration court, isolated Mongo only.
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const now=Math.floor(Date.now()/1000),b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
function jwt(sub){const input=b64({alg:'RS256',typ:'JWT'})+'.'+b64({iss:'https://isolated-auth.test',aud:'movie-mentor-creator-write',sub,iat:now,nbf:now-1,exp:now+600});return input+'.'+sign('RSA-SHA256',Buffer.from(input),privateKey).toString('base64url')}
const env={...process.env,PUBLIC_KEY_PEM:publicKey.export({type:'spki',format:'pem'}),OWNER_TOKEN:jwt('owner-1'),INTRUDER_TOKEN:jwt('intruder')};
for(const phase of ['seed','positive','seed','unknown','recover']){
 const result=spawnSync(process.execPath,['./verify-migrated-real-handler-physical-worker.mjs',phase],{env,encoding:'utf8',timeout:90000});
 process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');
 assert.equal(result.status,0,'physical real handler phase '+phase+' failed '+result.error?.message);
}
console.log('GREEN PHYSICAL_MOUNTED_REAL_REACT_HANDLER_HTTP_MONGO_POSITIVE_AND_UNKNOWN_RECOVERY');
console.log('HELD ORIGINAL_FRONTEND_CONTINUITY_RED_PUBLICATION_ADOPTION_AND_APPLICATION_MAIN');
