import {generateKeyPairSync,sign} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048}),now=Math.floor(Date.now()/1000);
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const jwt=sub=>{const d=`${b64({alg:'RS256',typ:'JWT'})}.${b64({iss:'https://isolated-auth.test',aud:'movie-mentor-creator-write',sub,iat:now,nbf:now-1,exp:now+300})}`;return d+'.'+sign('RSA-SHA256',Buffer.from(d),privateKey).toString('base64url')};
const env={...process.env,PUBLIC_KEY_PEM:publicKey.export({type:'spki',format:'pem'}),OWNER_TOKEN:jwt('owner-1'),INTRUDER_TOKEN:jwt('intruder')};
function runSync(mode){const r=spawnSync(process.execPath,['./verify-editable-adoption-grant-worker.mjs',mode],{env,encoding:'utf8',timeout:45000});if(r.status!==0)throw Error(r.stderr||r.error?.message);return r.stdout.trim()}
const ids=JSON.parse(runSync('seed'));
const run=(id)=>new Promise((resolve,reject)=>{const c=spawn(process.execPath,['./verify-editable-adoption-grant-worker.mjs','consume',id],{env});let out='',err='';c.stdout.on('data',d=>out+=d);c.stderr.on('data',d=>err+=d);c.on('exit',code=>code===0?resolve(JSON.parse(out.trim())):reject(Error(err||String(code))))});
const results=await Promise.all([run(ids.g1),run(ids.g2)]);
if(results.filter(x=>x.acquired).length!==1)throw Error('Expected exactly one winning independent process: '+JSON.stringify(results));
console.log('GREEN TWO_INDEPENDENT_CONTENDERS_EXACTLY_ONE_ADOPTER');
console.log(runSync('verify'));
console.log('HELD NONEMPTY_OUTBOX_PROVENANCE_AND_ORIGINAL_FRONTEND_CONTINUITY_RED');
