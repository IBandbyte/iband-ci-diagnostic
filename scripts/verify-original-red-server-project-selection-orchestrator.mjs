// Exact-source original frontend RED remains the regression; this is a
// distinct positive server-authorised alternative tested across fresh workers.
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const now=Math.floor(Date.now()/1000),b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
function jwt(sub){const payload=b64({alg:'RS256',typ:'JWT'})+'.'+b64({iss:'https://isolated-auth.test',aud:'movie-mentor-creator-write',sub,iat:now,nbf:now-1,exp:now+600});return payload+'.'+sign('RSA-SHA256',Buffer.from(payload),privateKey).toString('base64url')}
const env={...process.env,PUBLIC_KEY_PEM:publicKey.export({type:'spki',format:'pem'}),OWNER_TOKEN:jwt('owner-1'),INTRUDER_TOKEN:jwt('intruder')};
for(const phase of ['seed','select','verify']){
 const r=spawnSync(process.execPath,['./verify-original-red-server-project-selection-worker.mjs',phase],{env,encoding:'utf8',timeout:90000});
 process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');
 assert.equal(r.status,0,'server project selection phase '+phase+' failed '+(r.error?.message||''));
}
console.log('GREEN ORIGINAL_RED_SERVER_PROJECT_SELECTION_PHYSICAL_MONGO_OWNER_REVISION_REPLAY');
console.log('HELD ORIGINAL_FRONTEND_RED_UNCHANGED_AND_PRODUCTION_APPLICATION_ADOPTION');
