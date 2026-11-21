// Physical interruption of adopted real React handler after durable Mongo commit.
// Parent kills the worker process group before the HTTP receipt can reach React.
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const now=Math.floor(Date.now()/1000),b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
function jwt(sub){const data=b64({alg:'RS256',typ:'JWT'})+'.'+b64({iss:'https://isolated-auth.test',aud:'movie-mentor-creator-write',sub,iat:now,nbf:now-1,exp:now+600});return data+'.'+sign('RSA-SHA256',Buffer.from(data),privateKey).toString('base64url')}
const env={...process.env,PUBLIC_KEY_PEM:publicKey.export({type:'spki',format:'pem'}),OWNER_TOKEN:jwt('owner-1'),INTRUDER_TOKEN:jwt('intruder')};
function run(phase){
 const r=spawnSync(process.execPath,['./verify-adopted-real-handler-postcommit-sigkill-worker.mjs',phase],{env,encoding:'utf8',timeout:90000});
 process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');
 assert.equal(r.status,0,'adopted SIGKILL '+phase+' failed: '+(r.error?.message||''));
}
run('seed');
const child=spawn(process.execPath,['./verify-adopted-real-handler-postcommit-sigkill-worker.mjs','postkill'],{env,detached:true,stdio:['ignore','pipe','pipe']});
let stdout='',stderr='',killed=false;
const done=new Promise((resolve,reject)=>{
 let timeout=setTimeout(()=>reject(Error('postcommit SIGKILL gate timeout: '+stdout.slice(-3500)+' '+stderr.slice(-1800))),75000);
 child.stdout.on('data',chunk=>{
  const str=chunk.toString();stdout+=str;process.stdout.write(str);
  if(!killed&&stdout.includes('READY_TO_SIGKILL_AFTER_ADOPTED_HANDLER_MONGO_COMMIT_BEFORE_HTTP_RECEIPT')){
   killed=true;
   try{process.kill(-child.pid,'SIGKILL')}catch{child.kill('SIGKILL')}
  }
 });
 child.stderr.on('data',chunk=>{const str=chunk.toString();stderr+=str;process.stderr.write(str)});
 child.on('error',err=>{clearTimeout(timeout);reject(err)});
 child.on('exit',(code,signal)=>{clearTimeout(timeout);if(!killed||signal!=='SIGKILL')reject(Error('expected real SIGKILL after durable physical evidence: '+JSON.stringify({code,signal,stdout:stdout.slice(-2500),stderr:stderr.slice(-1000)})));else resolve()});
});
try{await done}finally{if(!killed){try{process.kill(-child.pid,'SIGKILL')}catch{child.kill('SIGKILL')}}}
assert.match(stdout,/GREEN ADOPTED_HANDLER_MONGO_COMMITTED_NO_OPTIMISTIC_REACT_PUBLICATION/);
console.log('GREEN ADOPTED_REAL_HANDLER_PHYSICAL_POSTCOMMIT_SIGKILL_OCCURRED_BEFORE_HTTP_RECEIPT');
run('recover');
console.log('GREEN ADOPTED_REAL_HANDLER_POSTCOMMIT_SIGKILL_FRESH_WORKER_DURABLE_RECOVERY');
console.log('HELD ORIGINAL_FRONTEND_RED_AND_IN_BROWSER_PENDING_REHYDRATION_AFTER_SIGKILL');
