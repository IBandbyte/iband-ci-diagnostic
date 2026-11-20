import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {spawnSync,spawn} from 'node:child_process';
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048}),now=Math.floor(Date.now()/1000),b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const jwt=sub=>{const d=`${b64({alg:'RS256',typ:'JWT'})}.${b64({iss:'https://isolated-auth.test',aud:'movie-mentor-creator-write',sub,iat:now,nbf:now-1,exp:now+300})}`;return d+'.'+sign('RSA-SHA256',Buffer.from(d),privateKey).toString('base64url')};
const env={...process.env,PUBLIC_KEY_PEM:publicKey.export({type:'spki',format:'pem'}),OWNER_TOKEN:jwt('owner-1'),INTRUDER_TOKEN:jwt('intruder')};
function sync(file,phase){const r=spawnSync(process.execPath,[file,phase],{env,encoding:'utf8',timeout:45000});process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');assert.equal(r.status,0,phase+' failed '+r.error?.message)}
function contender(i){return new Promise((resolve,reject)=>{const p=spawn(process.execPath,['./verify-server-owned-positive-edit-contention-worker.mjs','contend',String(i)],{env});let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',reject);p.on('close',code=>{process.stdout.write(out);process.stderr.write(err);if(code!==0)reject(Error('contender '+i+' exited '+code));else resolve(out)})})}
sync('./verify-server-owned-positive-edit-worker.mjs','seed');
sync('./verify-server-owned-positive-edit-worker.mjs','edit');
sync('./verify-server-owned-positive-edit-worker.mjs','restart');
const results=await Promise.all([contender(0),contender(1)]);
assert.equal(results.filter(x=>x.includes('COMMITTED')).length,1,'exactly one contender must commit');
assert.equal(results.filter(x=>x.includes('DENIED')).length,1,'exactly one contender must be denied');
sync('./verify-server-owned-positive-edit-contention-worker.mjs','verify');
