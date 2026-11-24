// Independent process orchestration for disposable pinned full Studio mount.
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const now=Math.floor(Date.now()/1000),b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
function jwt(sub,rotation='initial'){const data=b64({alg:'RS256',typ:'JWT'})+'.'+b64({iss:'https://isolated-auth.test',aud:'movie-mentor-creator-write',sub,jti:rotation,iat:now,nbf:now-1,exp:now+600});return data+'.'+sign('RSA-SHA256',Buffer.from(data),privateKey).toString('base64url')}
const env={...process.env,PUBLIC_KEY_PEM:publicKey.export({type:'spki',format:'pem'}),OWNER_TOKEN:jwt('owner-1'),RENEWED_OWNER_TOKEN:jwt('owner-1','renewed'),INTRUDER_TOKEN:jwt('intruder')};
for(const phase of ['seed','save','recover']){
 const r=spawnSync(process.execPath,['./verify-physical-async-authenticated-studio-react-worker.mjs',phase],{env:{...env,PHYSICAL_STUDIO_ROUTE:'0'},encoding:'utf8',timeout:90000});
 process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');
 assert.equal(r.status,0,'physical async-authenticated Studio native React journey phase '+phase+' failed: '+(r.error?.message||''));
}
console.log('GREEN PHYSICAL_ASYNC_AUTHENTICATED_STUDIO_REACT_HTTP_MONGO_RESTART_EXACTLY_ONCE');
// Run the independently seeded routed variant only after the original court passes.
for(const phase of ['seed','save','recover']){
 const r=spawnSync(process.execPath,['./verify-physical-async-authenticated-studio-react-worker.mjs',phase],{env:{...env,PHYSICAL_STUDIO_ROUTE:'1'},encoding:'utf8',timeout:90000});
 process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');
 assert.equal(r.status,0,'physical routed signed Mongo Studio journey phase '+phase+' failed: '+(r.error?.message||''));
}
console.log('GREEN PHYSICAL_ROUTED_STUDIO_SIGNED_HTTP_MONGO_RESTART_EXACTLY_ONCE');
const revoked=spawnSync(process.execPath,['./verify-physical-async-authenticated-studio-react-worker.mjs','revoked-restart'],{env:{...env,PHYSICAL_STUDIO_ROUTE:'1'},encoding:'utf8',timeout:90000});
process.stdout.write(revoked.stdout||'');process.stderr.write(revoked.stderr||'');
assert.equal(revoked.status,0,'fresh revoked vault process failed');
console.log('HELD LIVE_CLERK_AND_ORIGINAL_FRONTEND_RED_AND_APPLICATION_MAIN_ADOPTION');
