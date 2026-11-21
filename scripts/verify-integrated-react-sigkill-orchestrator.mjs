// Physical integrated React + authenticated HTTP + MongoDB crash/restart court.
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048}),now=Math.floor(Date.now()/1000);
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const jwt=sub=>{const payload=b64({alg:'RS256',typ:'JWT'})+'.'+b64({iss:'https://isolated-auth.test',aud:'movie-mentor-creator-write',sub,iat:now,nbf:now-1,exp:now+600});return payload+'.'+sign('RSA-SHA256',Buffer.from(payload),privateKey).toString('base64url')};
const env={...process.env,PUBLIC_KEY_PEM:publicKey.export({type:'spki',format:'pem'}),OWNER_TOKEN:jwt('owner-1'),INTRUDER_TOKEN:jwt('intruder')};
for(const phase of ['seed-pre','prekill','verify-pre','seed-post','postkill','recover']){
 const r=spawnSync(process.execPath,['./verify-integrated-react-sigkill-browser.mjs',phase],{env,encoding:'utf8',timeout:90000});
 process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');
 assert.equal(r.status,0,'integrated React SIGKILL phase '+phase+' failed '+r.error?.message);
}
console.log('GREEN INTEGRATED_REACT_HTTP_MONGO_SIGKILL_PRE_POST_RECOVERY');
console.log('HELD ORIGINAL_FRONTEND_RED_AND_PRODUCTION_REACT_HANDLER_MIGRATION');
