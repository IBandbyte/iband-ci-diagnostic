import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048}),now=Math.floor(Date.now()/1000);
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const jwt=sub=>{const data=b64({alg:'RS256',typ:'JWT'})+'.'+b64({iss:'https://isolated-auth.test',aud:'movie-mentor-creator-write',sub,iat:now,nbf:now-1,exp:now+300});return data+'.'+sign('RSA-SHA256',Buffer.from(data),privateKey).toString('base64url')};
const env={...process.env,PUBLIC_KEY_PEM:publicKey.export({type:'spki',format:'pem'}),OWNER_TOKEN:jwt('owner-1'),INTRUDER_TOKEN:jwt('intruder')};
for(const phase of ['seed','socket','recover']){
 const r=spawnSync(process.execPath,['./verify-isolated-react-atomic-http-worker.mjs',phase],{env,encoding:'utf8',timeout:45000});
 process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');
 assert.equal(r.status,0,phase+' failed '+r.error?.message);
}
console.log('HELD REAL_REACT_CREATOR_WORKSPACE_ATOMIC_HTTP_HANDLER_AND_ORIGINAL_FRONTEND_RED');
