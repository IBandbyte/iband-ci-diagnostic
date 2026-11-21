// Isolated exact-head server-authoritative positive restart publication court.
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const now=Math.floor(Date.now()/1000),encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const jwt=sub=>{const data=encode({alg:'RS256',typ:'JWT'})+'.'+encode({iss:'https://isolated-auth.test',aud:'movie-mentor-creator-write',sub,iat:now,nbf:now-1,exp:now+600});return data+'.'+sign('RSA-SHA256',Buffer.from(data),privateKey).toString('base64url')};
const env={...process.env,PUBLIC_KEY_PEM:publicKey.export({type:'spki',format:'pem'}),OWNER_TOKEN:jwt('owner-1'),INTRUDER_TOKEN:jwt('intruder')};
for(const phase of ['seed','restart','verify']){
 const result=spawnSync(process.execPath,['./verify-isolated-server-restart-positive-worker.mjs',phase],{env,encoding:'utf8',timeout:60000});
 process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');
 assert.equal(result.status,0,'positive restart publication '+phase+' failed '+result.error?.message);
}
console.log('GREEN ISOLATED_SERVER_AUTHORISED_POSITIVE_RESTART_PUBLICATION');
console.log('HELD REAL_FRONTEND_CREATOR_MEMORY_PUBLICATION_ADOPTION_AND_ORIGINAL_RED');
