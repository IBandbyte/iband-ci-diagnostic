// Independent process orchestration for disposable pinned full Studio mount.
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const now=Math.floor(Date.now()/1000),b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
function jwt(sub){const data=b64({alg:'RS256',typ:'JWT'})+'.'+b64({iss:'https://isolated-auth.test',aud:'movie-mentor-creator-write',sub,iat:now,nbf:now-1,exp:now+600});return data+'.'+sign('RSA-SHA256',Buffer.from(data),privateKey).toString('base64url')}
const env={...process.env,PUBLIC_KEY_PEM:publicKey.export({type:'spki',format:'pem'}),OWNER_TOKEN:jwt('owner-1'),INTRUDER_TOKEN:jwt('intruder')};
for(const phase of ['seed','save','recover']){
 const r=spawnSync(process.execPath,['./verify-physical-provenance-fenced-scene-recovery-worker.mjs',phase],{env,encoding:'utf8',timeout:90000});
 process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');
 assert.equal(r.status,0,'physical fenced scene settlement and recovery phase '+phase+' failed: '+(r.error?.message||''));
}
console.log('GREEN PHYSICAL_FENCED_SCENE_REACT_HTTP_MONGO_SOCKET_LOSS_FRESH_BROWSER_EXACTLY_ONCE');
console.log('HELD ORIGINAL_FRONTEND_RED_AND_APPLICATION_MAIN_ADOPTION');
